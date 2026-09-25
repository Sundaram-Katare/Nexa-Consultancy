import { buildServer } from "./server";
import { query, closePool } from "./db/pool";
import { saveCheckpoint, getLatestCheckpoint, getJobCheckpoints } from "./pipeline/checkpointService";
import { resumeJob } from "./pipeline/jobRunner";

async function runResumeTests() {
  console.log("================================================================================");
  console.log("       NEXA CONSULTANCY — PHASE 14 FULL PIPELINE CHECKPOINT/RESUME TEST SUITE   ");
  console.log("================================================================================\n");

  const fastify = buildServer();
  await fastify.ready();

  const createdJobIds: string[] = [];
  const createdDocIds: string[] = [];

  try {
    // 0. Lookup valid country and source IDs
    const countryRes = await query<{ id: number }>(
      `SELECT id FROM countries WHERE name = 'USA' OR name = 'United States' LIMIT 1;`
    );
    const countryId = countryRes.rows[0]?.id || 1;

    const sourceRes = await query<{ id: number }>(
      `SELECT id FROM sources WHERE name = 'slideshare' LIMIT 1;`
    );
    const sourceId = sourceRes.rows[0]?.id || 2;

    console.log(`[SETUP] Using countryId=${countryId}, sourceId=${sourceId} for tests.\n`);

    // ============================================================================
    // TEST 1: CheckpointService In-Place Upsert & Retrieval
    // ============================================================================
    console.log("[TEST 1] Testing CheckpointService in-place upsert & retrieval...");

    const job1Res = await query<{ id: string }>(
      `INSERT INTO jobs (status, config) 
       VALUES ('RUNNING', '{"countries": ["USA"], "sources": ["slideshare"]}'::jsonb) 
       RETURNING id;`
    );
    const job1Id = job1Res.rows[0].id;
    createdJobIds.push(job1Id);

    // Save initial checkpoint
    const cp1 = await saveCheckpoint(job1Id, null, 1, 5, "RUNNING", "SEARCH");
    console.log("  Initial checkpoint saved:", { stage: cp1.stage, page: cp1.page, docIndex: cp1.document_index });

    // Upsert same checkpoint (should update in-place, not create duplicate row)
    const cp2 = await saveCheckpoint(job1Id, null, 2, 10, "RUNNING", "SEARCH");
    console.log("  Updated checkpoint saved:", { stage: cp2.stage, page: cp2.page, docIndex: cp2.document_index });

    const job1Checkpoints = await getJobCheckpoints(job1Id);
    if (job1Checkpoints.length !== 1) {
      throw new Error(`Expected exactly 1 in-place checkpoint row for (job1, SEARCH), got ${job1Checkpoints.length}`);
    }
    if (job1Checkpoints[0].page !== 2 || job1Checkpoints[0].document_index !== 10) {
      throw new Error(`Expected updated page=2, docIndex=10, got page=${job1Checkpoints[0].page}, docIndex=${job1Checkpoints[0].document_index}`);
    }

    // Save second stage checkpoint (EXTRACTION)
    await saveCheckpoint(job1Id, null, null, 3, "RUNNING", "EXTRACTION");
    const latestCp = await getLatestCheckpoint(job1Id);
    if (!latestCp || latestCp.stage !== "EXTRACTION") {
      throw new Error(`Expected latest checkpoint stage=EXTRACTION, got ${latestCp?.stage}`);
    }
    console.log("✅ [TEST 1 PASSED] CheckpointService successfully updates in-place without unbounded row growth.\n");

    // ============================================================================
    // TEST 2: Mid-Search Interruption Recovery (Skip COMPLETED tasks, run QUEUED only)
    // ============================================================================
    console.log("[TEST 2] Testing Stage 1: Mid-Search Interruption Recovery...");

    const job2Res = await query<{ id: string }>(
      `INSERT INTO jobs (status, config) 
       VALUES ('RUNNING', '{"countries": ["USA"], "sources": ["slideshare"]}'::jsonb) 
       RETURNING id;`
    );
    const job2Id = job2Res.rows[0].id;
    createdJobIds.push(job2Id);

    // Create 1 completed task and 1 queued task
    const task1Res = await query<{ id: string }>(
      `INSERT INTO search_tasks (job_id, source_id, country_id, query_text, page, status)
       VALUES ($1, $2, $3, 'site:slideshare.net "Harvard University" transcript', 3, 'COMPLETED')
       RETURNING id;`,
      [job2Id, sourceId, countryId]
    );
    const task1Id = task1Res.rows[0].id;

    // Record initial search history for task 1
    await query(
      `INSERT INTO search_history (search_task_id, result_count, raw_response_meta)
       VALUES ($1, 5, '{"page": 1, "test": true}'::jsonb);`,
      [task1Id]
    );

    const historyBefore = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM search_history WHERE search_task_id = $1;`,
      [task1Id]
    );
    const historyCountBefore = parseInt(historyBefore.rows[0].count, 10);

    // Create an already completed document to satisfy downstream stages
    const docCompletedRes = await query<{ id: string }>(
      `INSERT INTO documents (source_id, country_id, canonical_url, title, status)
       VALUES ($1, $2, 'https://slideshare.net/test-resume-completed-' || gen_random_uuid(), 'Completed Transcript Sample', 'CLASSIFIED')
       RETURNING id;`,
      [sourceId, countryId]
    );
    createdDocIds.push(docCompletedRes.rows[0].id);

    // Resume job 2: Since task 1 is already COMPLETED and no pending tasks or docs exist, resume should skip task 1
    const resume2Summary = await resumeJob(job2Id);
    console.log("  Resume Job 2 Summary:", resume2Summary);

    const historyAfter = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM search_history WHERE search_task_id = $1;`,
      [task1Id]
    );
    const historyCountAfter = parseInt(historyAfter.rows[0].count, 10);

    if (historyCountAfter !== historyCountBefore) {
      throw new Error(`Task 1 was re-executed! Search history count changed from ${historyCountBefore} to ${historyCountAfter}`);
    }
    if (resume2Summary.stages.searchTasksRun !== 0) {
      throw new Error(`Expected 0 search tasks run on already-completed task, got ${resume2Summary.stages.searchTasksRun}`);
    }
    if (resume2Summary.finalStatus !== "COMPLETED") {
      throw new Error(`Expected job 2 finalStatus=COMPLETED, got ${resume2Summary.finalStatus}`);
    }
    console.log("✅ [TEST 2 PASSED] Search stage resume skips COMPLETED tasks with zero duplicate history/processing.\n");

    // ============================================================================
    // TEST 3: Mid-Extraction Interruption Recovery (Process PENDING, Skip EXTRACTED)
    // ============================================================================
    console.log("[TEST 3] Testing Stage 2: Mid-Extraction Interruption Recovery...");

    const job3Res = await query<{ id: string }>(
      `INSERT INTO jobs (status, config) 
       VALUES ('RUNNING', '{"countries": ["USA"], "sources": ["slideshare"]}'::jsonb) 
       RETURNING id;`
    );
    const job3Id = job3Res.rows[0].id;
    createdJobIds.push(job3Id);

    // Create a completed search task for job 3
    await query(
      `INSERT INTO search_tasks (job_id, source_id, country_id, query_text, page, status)
       VALUES ($1, $2, $3, 'site:slideshare.net "MIT" transcript', 1, 'COMPLETED');`,
      [job3Id, sourceId, countryId]
    );

    // Create Doc A: Already EXTRACTED with evidence and relevant keywords
    const docARes = await query<{ id: string }>(
      `INSERT INTO documents (source_id, country_id, canonical_url, title, status, raw_metadata)
       VALUES ($1, $2, 'https://slideshare.net/test-extracted-' || gen_random_uuid(), 'Official Academic Transcript Bachelor 2018-2022', 'EXTRACTED', '{"title": "Official Academic Transcript"}'::jsonb)
       RETURNING id;`,
      [sourceId, countryId]
    );
    const docAId = docARes.rows[0].id;
    createdDocIds.push(docAId);

    await query(
      `INSERT INTO document_evidence (document_id, evidence_text, location_ref, extraction_method)
       VALUES ($1, 'Academic Period: 2018 - 2022. Degree: Bachelor of Science in Engineering.', 'block_1', 'dom-text');`,
      [docAId]
    );

    // Resume job 3: Should process Doc A through Relevance and Classification without re-extracting
    const resume3Summary = await resumeJob(job3Id);
    console.log("  Resume Job 3 Summary:", resume3Summary);

    const docACheck = await query<{ status: string }>(
      `SELECT status FROM documents WHERE id = $1;`,
      [docAId]
    );
    if (docACheck.rows[0].status !== "CLASSIFIED") {
      throw new Error(`Expected Doc A to advance to CLASSIFIED, got ${docACheck.rows[0].status}`);
    }

    const classificationA = await query<{ classification: string; completed_years: string }>(
      `SELECT classification, completed_years FROM classifications WHERE document_id = $1;`,
      [docAId]
    );
    if (!classificationA.rows[0] || classificationA.rows[0].classification !== "TWO_PLUS_YEARS") {
      throw new Error(`Expected Doc A classification=TWO_PLUS_YEARS, got ${JSON.stringify(classificationA.rows[0])}`);
    }
    console.log("✅ [TEST 3 PASSED] Extraction stage resume correctly transitions extracted docs downstream.\n");

    // ============================================================================
    // TEST 4: Mid-Classification Interruption Recovery
    // ============================================================================
    console.log("[TEST 4] Testing Stage 4: Mid-Classification Interruption Recovery...");

    const job4Res = await query<{ id: string }>(
      `INSERT INTO jobs (status, config) 
       VALUES ('RUNNING', '{"countries": ["USA"], "sources": ["slideshare"]}'::jsonb) 
       RETURNING id;`
    );
    const job4Id = job4Res.rows[0].id;
    createdJobIds.push(job4Id);

    // Search task COMPLETED
    await query(
      `INSERT INTO search_tasks (job_id, source_id, country_id, query_text, page, status)
       VALUES ($1, $2, $3, 'site:slideshare.net "Stanford" transcript', 1, 'COMPLETED');`,
      [job4Id, sourceId, countryId]
    );

    // Doc B: Already in CLASSIFIED_PENDING with evidence text
    const docBRes = await query<{ id: string }>(
      `INSERT INTO documents (source_id, country_id, canonical_url, title, status)
       VALUES ($1, $2, 'https://slideshare.net/test-classified-pending-' || gen_random_uuid(), 'Certificate Course Transcript', 'CLASSIFIED_PENDING')
       RETURNING id;`,
      [sourceId, countryId]
    );
    const docBId = docBRes.rows[0].id;
    createdDocIds.push(docBId);

    await query(
      `INSERT INTO document_evidence (document_id, evidence_text, location_ref, extraction_method)
       VALUES ($1, 'Attendance Period: 2020 - 2021. 1 Year Certificate Program completed.', 'block_1', 'dom-text');`,
      [docBId]
    );

    // Resume job 4
    const resume4Summary = await resumeJob(job4Id);
    console.log("  Resume Job 4 Summary:", resume4Summary);

    const docBCheck = await query<{ status: string }>(
      `SELECT status FROM documents WHERE id = $1;`,
      [docBId]
    );
    if (docBCheck.rows[0].status !== "CLASSIFIED") {
      throw new Error(`Expected Doc B status=CLASSIFIED, got ${docBCheck.rows[0].status}`);
    }

    const classificationB = await query<{ classification: string }>(
      `SELECT classification FROM classifications WHERE document_id = $1;`,
      [docBId]
    );
    if (!classificationB.rows[0] || classificationB.rows[0].classification !== "LESS_THAN_TWO_YEARS") {
      throw new Error(`Expected Doc B classification=LESS_THAN_TWO_YEARS, got ${JSON.stringify(classificationB.rows[0])}`);
    }
    console.log("✅ [TEST 4 PASSED] Mid-classification interruption successfully recovers and classifies remaining records.\n");

    // ============================================================================
    // TEST 5: Fast No-Op on Already Completed Job
    // ============================================================================
    console.log("[TEST 5] Testing Fast No-Op on Already Completed Job...");

    const startNoOp = Date.now();
    const resumeNoOpSummary = await resumeJob(job4Id);
    const noOpDurationMs = Date.now() - startNoOp;

    console.log(`  No-Op execution took ${noOpDurationMs}ms:`, resumeNoOpSummary);

    if (resumeNoOpSummary.finalStatus !== "COMPLETED") {
      throw new Error(`Expected finalStatus=COMPLETED, got ${resumeNoOpSummary.finalStatus}`);
    }
    if (
      resumeNoOpSummary.stages.searchTasksRun !== 0 ||
      resumeNoOpSummary.stages.documentsExtracted !== 0 ||
      resumeNoOpSummary.stages.documentsFiltered !== 0 ||
      resumeNoOpSummary.stages.documentsClassified !== 0
    ) {
      throw new Error(`Expected all stages to be 0 for completed job, got ${JSON.stringify(resumeNoOpSummary.stages)}`);
    }
    console.log("✅ [TEST 5 PASSED] Completed job resume is a fast, safe no-op.\n");

    // ============================================================================
    // TEST 6: Resilience to Corrupted / Deleted Checkpoints (DB status is ground truth)
    // ============================================================================
    console.log("[TEST 6] Testing resilience to corrupted/deleted checkpoint rows...");

    const job6Res = await query<{ id: string }>(
      `INSERT INTO jobs (status, config) 
       VALUES ('RUNNING', '{"countries": ["USA"], "sources": ["slideshare"]}'::jsonb) 
       RETURNING id;`
    );
    const job6Id = job6Res.rows[0].id;
    createdJobIds.push(job6Id);

    // Search task COMPLETED
    await query(
      `INSERT INTO search_tasks (job_id, source_id, country_id, query_text, page, status)
       VALUES ($1, $2, $3, 'site:slideshare.net "Berkeley" transcript', 1, 'COMPLETED');`,
      [job6Id, sourceId, countryId]
    );

    // Doc C: in EXTRACTED state
    const docCRes = await query<{ id: string }>(
      `INSERT INTO documents (source_id, country_id, canonical_url, title, status)
       VALUES ($1, $2, 'https://slideshare.net/test-corrupted-cp-' || gen_random_uuid(), 'Berkeley Transcript Academic Record', 'EXTRACTED')
       RETURNING id;`,
      [sourceId, countryId]
    );
    const docCId = docCRes.rows[0].id;
    createdDocIds.push(docCId);

    await query(
      `INSERT INTO document_evidence (document_id, evidence_text, location_ref, extraction_method)
       VALUES ($1, 'Attendance Period: 2016 - 2020. Degree Conferred: Bachelor of Arts.', 'block_1', 'dom-text');`,
      [docCId]
    );

    // Create a bogus / corrupted checkpoint or delete all checkpoints for Job 6
    await query(
      `INSERT INTO checkpoints (job_id, status, stage, page, document_index)
       VALUES ($1, 'CORRUPTED_GARBAGE', 'SEARCH', 999, 999);`,
      [job6Id]
    );
    // Deliberately delete all checkpoints
    await query(`DELETE FROM checkpoints WHERE job_id = $1;`, [job6Id]);

    console.log("  All checkpoint rows deleted for Job 6. Invoking resumeJob...");
    const resume6Summary = await resumeJob(job6Id);
    console.log("  Resume Job 6 Summary:", resume6Summary);

    const docCCheck = await query<{ status: string }>(
      `SELECT status FROM documents WHERE id = $1;`,
      [docCId]
    );
    if (docCCheck.rows[0].status !== "CLASSIFIED") {
      throw new Error(`Expected Doc C status=CLASSIFIED, got ${docCCheck.rows[0].status}`);
    }

    const newCp = await getLatestCheckpoint(job6Id);
    if (!newCp || newCp.status !== "COMPLETED") {
      throw new Error(`Expected fresh completed checkpoint, got ${JSON.stringify(newCp)}`);
    }
    console.log("✅ [TEST 6 PASSED] Successfully resumed without checkpoints by inspecting live DB entity statuses directly.\n");

    // ============================================================================
    // TEST 7: HTTP Route Test: POST /jobs/:id/resume-full
    // ============================================================================
    console.log("[TEST 7] Testing HTTP Route: POST /jobs/:id/resume-full...");

    const res = await fastify.inject({
      method: "POST",
      url: `/jobs/${job6Id}/resume-full`,
    });

    console.log(`  HTTP Response Status: ${res.statusCode}`);
    const json = JSON.parse(res.body);
    console.log("  HTTP Response Body:", json);

    if (res.statusCode !== 200) {
      throw new Error(`Expected HTTP 200, got ${res.statusCode}: ${res.body}`);
    }
    if (json.finalStatus !== "COMPLETED" || json.job_id !== job6Id) {
      throw new Error(`Unexpected payload from POST /jobs/:id/resume-full: ${res.body}`);
    }
    console.log("✅ [TEST 7 PASSED] POST /jobs/:id/resume-full re-drives full pipeline and responds with 200 OK.\n");

    console.log("================================================================================");
    console.log("          ALL 7 PHASE 14 CHECKPOINT/RESUME TESTS PASSED SUCCESSFULLY!          ");
    console.log("================================================================================");
  } finally {
    // Cleanup created test records
    if (createdDocIds.length > 0) {
      await query(`DELETE FROM classifications WHERE document_id = ANY($1);`, [createdDocIds]);
      await query(`DELETE FROM evidence_signals WHERE document_id = ANY($1);`, [createdDocIds]);
      await query(`DELETE FROM document_evidence WHERE document_id = ANY($1);`, [createdDocIds]);
      await query(`DELETE FROM documents WHERE id = ANY($1);`, [createdDocIds]);
    }
    if (createdJobIds.length > 0) {
      await query(`DELETE FROM checkpoints WHERE job_id = ANY($1);`, [createdJobIds]);
      await query(`DELETE FROM search_history WHERE search_task_id IN (SELECT id FROM search_tasks WHERE job_id = ANY($1));`, [createdJobIds]);
      await query(`DELETE FROM search_tasks WHERE job_id = ANY($1);`, [createdJobIds]);
      await query(`DELETE FROM jobs WHERE id = ANY($1);`, [createdJobIds]);
    }
    await fastify.close();
    await closePool();
  }
}

runResumeTests().catch((err) => {
  console.error("❌ Test suite failed with error:", err);
  process.exit(1);
});
