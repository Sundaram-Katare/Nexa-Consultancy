import { query } from "../db/pool";
import { getJobById, updateJobStatus } from "../db/queries/jobs";
import { runTask } from "../executor/searchExecutor";
import { processPendingDocuments } from "../executor/extractionWorker";
import { runRelevanceFilter } from "../relevance/relevanceFilter";
import { extractDurationSignals } from "../evidence/evidenceExtractor";
import { classify } from "../classification/classificationEngine";
import { saveCheckpoint } from "./checkpointService";

export interface ResumeJobSummary {
  jobId: string;
  initialStatus: string;
  finalStatus: "COMPLETED" | "RUNNING" | "FAILED" | "PAUSED" | "BLOCKED";
  stages: {
    searchTasksRun: number;
    documentsExtracted: number;
    documentsFiltered: number;
    documentsClassified: number;
  };
  resumedAt: string;
  completedAt?: string;
  message?: string;
}

export class JobRunner {
  /**
   * Resumes an interrupted or partially executed job from its exact point of interruption.
   *
   * CRITICAL DESIGN PRINCIPLE:
   * This function does NOT trust the checkpoints table alone as ground truth.
   * Checkpoints serve as operational progress logs, but actual database entity statuses
   * (search_tasks.status, documents.status, classifications.id) are the single source
   * of truth.
   *
   * Work stages executed deterministically:
   * 1. Search Tasks: Any search_tasks with status IN ('QUEUED', 'RUNNING', 'PAUSED')
   * 2. Document Extraction: Any documents with status 'PENDING'
   * 3. Relevance Filtering: Any documents with status 'EXTRACTED'
   * 4. 2-Year Classification: Any documents with status 'CLASSIFIED_PENDING' lacking a classification row
   */
  public async resumeJob(jobId: string): Promise<ResumeJobSummary> {
    const resumedAt = new Date().toISOString();
    console.log(`[JOB_RUNNER] Resuming pipeline for Job ${jobId}...`);

    // 1. Fetch job record
    const job = await getJobById(jobId);
    if (!job) {
      throw new Error(`Job with ID '${jobId}' was not found.`);
    }

    const initialStatus = job.status;

    // 2. Identify associated source names for this job
    const sourceRows = await query<{ name: string }>(
      `SELECT DISTINCT s.name 
       FROM search_tasks st 
       JOIN sources s ON st.source_id = s.id 
       WHERE st.job_id = $1;`,
      [jobId]
    );

    let sources = sourceRows.rows.map((r) => r.name);
    if (sources.length === 0 && (job.config as any)?.sources) {
      sources = (job.config as any).sources;
    }
    if (sources.length === 0) {
      sources = ["slideshare"];
    }

    let searchTasksRun = 0;
    let documentsExtracted = 0;
    let documentsFiltered = 0;
    let documentsClassified = 0;

    // -------------------------------------------------------------
    // STAGE 1: Process Remaining Search Tasks
    // -------------------------------------------------------------
    const pendingTasks = await query<{
      id: string;
      status: string;
      page: number;
      query_text: string;
    }>(
      `SELECT id, status, page, query_text 
       FROM search_tasks 
       WHERE job_id = $1 
         AND status IN ('QUEUED', 'RUNNING', 'PAUSED')
       ORDER BY created_at ASC;`,
      [jobId]
    );

    console.log(
      `[JOB_RUNNER] [Stage 1 - Search] Found ${pendingTasks.rows.length} pending search tasks.`
    );

    if (pendingTasks.rows.length > 0) {
      if (job.status !== "RUNNING") {
        await updateJobStatus(jobId, "RUNNING");
      }

      for (const task of pendingTasks.rows) {
        console.log(
          `[JOB_RUNNER] [Stage 1 - Search] Executing pending task ${task.id} ("${task.query_text}")...`
        );
        await runTask(task.id);
        searchTasksRun++;
      }
    }

    // -------------------------------------------------------------
    // STAGE 2: Process Pending Document Extractions
    // -------------------------------------------------------------
    console.log(`[JOB_RUNNER] [Stage 2 - Extraction] Checking for PENDING documents...`);
    while (true) {
      const pendingDocs = await query<{ count: string }>(
        `SELECT COUNT(*) as count 
         FROM documents d
         JOIN sources s ON d.source_id = s.id
         WHERE d.status = 'PENDING'
           AND (LOWER(s.name) = ANY($1) OR s.id::text = ANY($1));`,
        [sources.map((s) => s.toLowerCase())]
      );

      const pendingCount = parseInt(pendingDocs.rows[0]?.count || "0", 10);
      if (pendingCount === 0) break;

      console.log(
        `[JOB_RUNNER] [Stage 2 - Extraction] ${pendingCount} PENDING documents remaining. Extracting batch...`
      );

      let extractedInPass = 0;
      for (const src of sources) {
        const res = await processPendingDocuments(src, 10, jobId);
        documentsExtracted += res.extractedCount;
        extractedInPass += res.totalProcessed;
      }

      if (extractedInPass === 0) {
        // Break if no items were processed to avoid infinite loop on stubborn errors
        break;
      }
    }

    // -------------------------------------------------------------
    // STAGE 3: Process Extracted Documents through Relevance Filter
    // -------------------------------------------------------------
    console.log(
      `[JOB_RUNNER] [Stage 3 - Relevance] Checking for EXTRACTED documents needing filter...`
    );
    while (true) {
      const extractedDocs = await query<{ count: string }>(
        `SELECT COUNT(*) as count 
         FROM documents d
         JOIN sources s ON d.source_id = s.id
         WHERE d.status = 'EXTRACTED'
           AND (LOWER(s.name) = ANY($1) OR s.id::text = ANY($1));`,
        [sources.map((s) => s.toLowerCase())]
      );

      const extractedCount = parseInt(extractedDocs.rows[0]?.count || "0", 10);
      if (extractedCount === 0) break;

      console.log(
        `[JOB_RUNNER] [Stage 3 - Relevance] ${extractedCount} EXTRACTED documents remaining. Filtering batch...`
      );

      let filteredInPass = 0;
      for (const src of sources) {
        const filterRes = await runRelevanceFilter(src, 20, jobId);
        documentsFiltered += filterRes.totalProcessed;
        filteredInPass += filterRes.totalProcessed;
      }

      if (filteredInPass === 0) break;
    }

    // -------------------------------------------------------------
    // STAGE 4: Process CLASSIFIED_PENDING Documents (Evidence + Classification)
    // -------------------------------------------------------------
    console.log(
      `[JOB_RUNNER] [Stage 4 - Classification] Checking for unclassified CLASSIFIED_PENDING documents...`
    );
    while (true) {
      const unclassifiedDocs = await query<{ id: string }>(
        `SELECT d.id 
         FROM documents d
         JOIN sources s ON d.source_id = s.id
         LEFT JOIN classifications c ON d.id = c.document_id
         WHERE d.status = 'CLASSIFIED_PENDING'
           AND c.id IS NULL
           AND (LOWER(s.name) = ANY($1) OR s.id::text = ANY($1))
         LIMIT 20;`,
        [sources.map((s) => s.toLowerCase())]
      );

      if (unclassifiedDocs.rows.length === 0) break;

      console.log(
        `[JOB_RUNNER] [Stage 4 - Classification] Processing ${unclassifiedDocs.rows.length} documents...`
      );

      for (const doc of unclassifiedDocs.rows) {
        await extractDurationSignals(doc.id);
        await classify(doc.id);
        documentsClassified++;

        await saveCheckpoint(
          jobId,
          null,
          null,
          documentsClassified,
          "RUNNING",
          "CLASSIFICATION"
        );
      }
    }

    // -------------------------------------------------------------
    // STAGE 5: Evaluate Final Completion State
    // -------------------------------------------------------------
    const remainingTasks = await query<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM search_tasks 
       WHERE job_id = $1 
         AND status IN ('QUEUED', 'RUNNING', 'PAUSED');`,
      [jobId]
    );

    const remainingPendingDocs = await query<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM documents d
       JOIN sources s ON d.source_id = s.id
       WHERE d.status = 'PENDING'
         AND (LOWER(s.name) = ANY($1) OR s.id::text = ANY($1));`,
      [sources.map((s) => s.toLowerCase())]
    );

    const remainingExtractedDocs = await query<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM documents d
       JOIN sources s ON d.source_id = s.id
       WHERE d.status = 'EXTRACTED'
         AND (LOWER(s.name) = ANY($1) OR s.id::text = ANY($1));`,
      [sources.map((s) => s.toLowerCase())]
    );

    const remainingUnclassifiedDocs = await query<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM documents d
       JOIN sources s ON d.source_id = s.id
       LEFT JOIN classifications c ON d.id = c.document_id
       WHERE d.status = 'CLASSIFIED_PENDING'
         AND c.id IS NULL
         AND (LOWER(s.name) = ANY($1) OR s.id::text = ANY($1));`,
      [sources.map((s) => s.toLowerCase())]
    );

    const tasksLeft = parseInt(remainingTasks.rows[0]?.count || "0", 10);
    const docsPendingLeft = parseInt(remainingPendingDocs.rows[0]?.count || "0", 10);
    const docsExtractedLeft = parseInt(remainingExtractedDocs.rows[0]?.count || "0", 10);
    const docsUnclassifiedLeft = parseInt(remainingUnclassifiedDocs.rows[0]?.count || "0", 10);

    const isFullyComplete =
      tasksLeft === 0 &&
      docsPendingLeft === 0 &&
      docsExtractedLeft === 0 &&
      docsUnclassifiedLeft === 0;

    let finalStatus: "COMPLETED" | "RUNNING" = isFullyComplete ? "COMPLETED" : "RUNNING";

    if (isFullyComplete) {
      await updateJobStatus(jobId, "COMPLETED");
      await saveCheckpoint(
        jobId,
        null,
        null,
        documentsClassified,
        "COMPLETED",
        "CLASSIFICATION"
      );
      console.log(`[JOB_RUNNER] ✅ Job ${jobId} is fully COMPLETED across all pipeline stages.`);
    } else {
      console.log(
        `[JOB_RUNNER] ⚠️ Job ${jobId} has remaining items (Tasks: ${tasksLeft}, PendingDocs: ${docsPendingLeft}, ExtractedDocs: ${docsExtractedLeft}, UnclassifiedDocs: ${docsUnclassifiedLeft}).`
      );
    }

    const completedAt = new Date().toISOString();

    return {
      jobId,
      initialStatus,
      finalStatus,
      stages: {
        searchTasksRun,
        documentsExtracted,
        documentsFiltered,
        documentsClassified,
      },
      resumedAt,
      completedAt,
      message: isFullyComplete
        ? "Job pipeline completed successfully with zero remaining queue items."
        : "Job partially resumed; some work items remain in progress or failed retry limits.",
    };
  }
}

export const jobRunner = new JobRunner();
export const resumeJob = jobRunner.resumeJob.bind(jobRunner);
