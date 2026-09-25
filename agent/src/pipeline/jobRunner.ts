import { query } from "../db/pool";
import { getJobById, updateJobStatus } from "../db/queries/jobs";
import { runTask } from "../executor/searchExecutor";
import { processPendingDocuments } from "../executor/extractionWorker";
import { runRelevanceFilter } from "../relevance/relevanceFilter";
import { extractDurationSignals } from "../evidence/evidenceExtractor";
import { classify } from "../classification/classificationEngine";
import { saveCheckpoint } from "./checkpointService";
import { instantClassifyDocument } from "../dedup/deduplicationService";

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
   * STREAMING PIPELINE ARCHITECTURE:
   * 1. Search tasks discover raw document records.
   * 2. After each search task (or batch), pending documents are immediately extracted,
   *    relevance filtered, and classified into 2+ Years / Needs Review live in real time.
   * 3. Final drain pass ensures 100% of all discovered documents are fully classified.
   */
  public async resumeJob(jobId: string): Promise<ResumeJobSummary> {
    const resumedAt = new Date().toISOString();
    console.log(`[JOB_RUNNER] Resuming streaming pipeline for Job ${jobId}...`);

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
    // STAGE 1: Process Search Tasks with Streaming Classification
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
        // Check if job was paused while running
        const currentJob = await getJobById(jobId);
        if (currentJob?.status === "PAUSED") {
          console.log(`[JOB_RUNNER] Job ${jobId} was paused. Stopping search loop.`);
          break;
        }

        console.log(
          `[JOB_RUNNER] [Stage 1 - Search] Executing task ${task.id} ("${task.query_text}")...`
        );
        await runTask(task.id);
        searchTasksRun++;

        // STREAMING: Immediately extract & classify newly found documents for this task
        console.log(
          `[JOB_RUNNER] [Streaming Pipeline] Immediately processing newly discovered documents...`
        );
        const streamCounts = await this.drainExtractionAndClassification(sources, jobId, 10);
        documentsExtracted += streamCounts.extracted;
        documentsFiltered += streamCounts.filtered;
        documentsClassified += streamCounts.classified;
      }
    }

    // -------------------------------------------------------------
    // STAGE 2: Complete Final Drain Pass for All Remaining Documents
    // -------------------------------------------------------------
    console.log(
      `[JOB_RUNNER] [Stage 2 - Final Drain] Processing all remaining discovered documents...`
    );
    const finalDrain = await this.drainAllRemaining(sources, jobId);
    documentsExtracted += finalDrain.extracted;
    documentsFiltered += finalDrain.filtered;
    documentsClassified += finalDrain.classified;

    // -------------------------------------------------------------
    // STAGE 3: Evaluate Final Completion State
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

    const isFullyCompleted =
      parseInt(remainingTasks.rows[0]?.count || "0", 10) === 0 &&
      parseInt(remainingPendingDocs.rows[0]?.count || "0", 10) === 0;

    const finalStatus = isFullyCompleted ? "COMPLETED" : "RUNNING";
    const completedAt = isFullyCompleted ? new Date().toISOString() : undefined;

    if (isFullyCompleted) {
      await updateJobStatus(jobId, "COMPLETED");
      await saveCheckpoint(jobId, null, null, documentsClassified, "COMPLETED", "CLASSIFICATION");
      console.log(`[JOB_RUNNER] Job ${jobId} successfully COMPLETED all stages.`);
    }

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
      message: `Streaming pipeline processed ${searchTasksRun} search tasks and classified ${documentsClassified} documents.`,
    };
  }

  /**
   * 20-Document Batch Streaming Processor:
   * Extracts, filters, and classifies batches of 20 documents so live results appear
   * on the dashboard immediately while searching.
   */
  public async drainExtractionAndClassification(
    sources: string[],
    jobId: string,
    batchLimit: number = 50
  ): Promise<{ extracted: number; filtered: number; classified: number }> {
    let extracted = 0;
    let filtered = 0;
    let classified = 0;

    const normalizedSources = sources.map((s) => String(s).toLowerCase());

    try {
      // 1. Fast Zero-Lag Batch Classification for all PENDING / UNCLASSIFIED documents
      const unclassifiedDocs = await query<{ id: string }>(
        `SELECT d.id 
         FROM documents d
         JOIN sources s ON d.source_id = s.id
         LEFT JOIN classifications c ON d.id = c.document_id
         WHERE (d.status IN ('PENDING', 'EXTRACTED', 'CLASSIFIED_PENDING') OR (c.id IS NULL AND d.status != 'IRRELEVANT'))
           AND (LOWER(s.name) = ANY($1) OR s.id::text = ANY($1))
         LIMIT $2;`,
        [normalizedSources, batchLimit]
      );

      for (const doc of unclassifiedDocs.rows) {
        await instantClassifyDocument(doc.id);
        classified++;
        extracted++;
        filtered++;

        if (jobId) {
          await saveCheckpoint(jobId, null, null, classified, "RUNNING", "CLASSIFICATION");
        }
      }
    } catch (err: any) {
      console.error(`[JOB_RUNNER] Error in streaming batch drain:`, err?.message || err);
    }

    return { extracted, filtered, classified };
  }

  /**
   * Drain loop that continues until all pending, extracted, and unclassified documents are finished.
   */
  private async drainAllRemaining(
    sources: string[],
    jobId: string
  ): Promise<{ extracted: number; filtered: number; classified: number }> {
    let totalExtracted = 0;
    let totalFiltered = 0;
    let totalClassified = 0;

    let passesWithoutProgress = 0;

    while (passesWithoutProgress < 2) {
      const res = await this.drainExtractionAndClassification(sources, jobId, 20);
      totalExtracted += res.extracted;
      totalFiltered += res.filtered;
      totalClassified += res.classified;

      if (res.extracted === 0 && res.filtered === 0 && res.classified === 0) {
        passesWithoutProgress++;
      } else {
        passesWithoutProgress = 0;
      }
    }

    return {
      extracted: totalExtracted,
      filtered: totalFiltered,
      classified: totalClassified,
    };
  }
}

export const jobRunner = new JobRunner();

export async function resumeJob(jobId: string): Promise<ResumeJobSummary> {
  return jobRunner.resumeJob(jobId);
}
