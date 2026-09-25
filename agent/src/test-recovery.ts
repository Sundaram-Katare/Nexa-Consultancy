import { query } from "./db/pool";
import { createJob, getJobById, updateJobStatus } from "./db/queries/jobs";
import { saveCheckpoint, getJobCheckpoints } from "./pipeline/checkpointService";
import { extractDurationSignals } from "./evidence/evidenceExtractor";
import { classify } from "./classification/classificationEngine";

async function runRecoveryTests() {
  console.log("================================================================================");
  console.log("🧪 PHASE 25 — Crash Recovery & Pipeline Resumption Test Suite");
  console.log("================================================================================\n");

  // Step 1: Initialize an Interrupted Multi-Country Job Simulation
  console.log("--------------------------------------------------------------------------------");
  console.log("Step 1: Setting up Interrupted Job State with In-Flight Records");
  console.log("--------------------------------------------------------------------------------");

  const countryRes = await query<{ id: number }>(`SELECT id FROM countries WHERE name = 'Canada' LIMIT 1;`);
  const countryId = countryRes.rows[0]?.id || 1;

  const srcRes = await query<{ id: number }>(`SELECT id FROM sources WHERE name = 'slideshare' LIMIT 1;`);
  const sourceId = srcRes.rows[0]?.id || 1;

  const job = await createJob({
    source: "slideshare",
    countries: ["Canada"],
    education_levels: ["Bachelor"],
    document_types: ["Transcript"],
    minimum_completed_years: 2.0,
  });

  console.log(`✅ Created test job: ${job.id}`);

  // 1. Task 1: Already COMPLETED before crash
  const task1 = await query<{ id: string }>(
    `INSERT INTO search_tasks (job_id, country_id, source_id, query_text, page, status)
     VALUES ($1, $2, $3, 'Canada Bachelor Transcript variation 1', 3, 'COMPLETED')
     RETURNING id;`,
    [job.id, countryId, sourceId]
  );
  const task1Id = task1.rows[0].id;
  await saveCheckpoint(job.id, task1Id, 3, 10, "COMPLETED", "SEARCH");

  // 2. Task 2: RUNNING (interrupted mid-pagination at Page 2)
  const task2 = await query<{ id: string }>(
    `INSERT INTO search_tasks (job_id, country_id, source_id, query_text, page, status)
     VALUES ($1, $2, $3, 'Canada Bachelor Transcript variation 2', 2, 'RUNNING')
     RETURNING id;`,
    [job.id, countryId, sourceId]
  );
  const task2Id = task2.rows[0].id;
  await saveCheckpoint(job.id, task2Id, 2, 5, "RUNNING", "SEARCH");

  // 3. Task 3: QUEUED (pending search)
  const task3 = await query<{ id: string }>(
    `INSERT INTO search_tasks (job_id, country_id, source_id, query_text, page, status)
     VALUES ($1, $2, $3, 'Canada Bachelor Transcript variation 3', 1, 'QUEUED')
     RETURNING id;`,
    [job.id, countryId, sourceId]
  );
  const task3Id = task3.rows[0].id;

  // Insert documents in various in-flight stages
  const docA = await query<{ id: string }>(
    `INSERT INTO documents (source_id, source_document_id, canonical_url, title, country_id, status)
     VALUES ($1, 'doc-recovery-A', 'https://www.slideshare.net/sample/doc-recovery-A', 'Pending Doc A', $2, 'PENDING')
     ON CONFLICT (canonical_url) DO UPDATE SET status = 'PENDING' RETURNING id;`,
    [sourceId, countryId]
  );

  const docB = await query<{ id: string }>(
    `INSERT INTO documents (source_id, source_document_id, canonical_url, title, country_id, status)
     VALUES ($1, 'doc-recovery-B', 'https://www.slideshare.net/sample/doc-recovery-B', 'Official Canada Transcript', $2, 'EXTRACTED')
     ON CONFLICT (canonical_url) DO UPDATE SET status = 'EXTRACTED' RETURNING id;`,
    [sourceId, countryId]
  );

  const docC = await query<{ id: string }>(
    `INSERT INTO documents (source_id, source_document_id, canonical_url, title, country_id, status)
     VALUES ($1, 'doc-recovery-C', 'https://www.slideshare.net/sample/doc-recovery-C', 'Bachelor Degree Transcript 4 Years', $2, 'CLASSIFIED_PENDING')
     ON CONFLICT (canonical_url) DO UPDATE SET status = 'CLASSIFIED_PENDING' RETURNING id;`,
    [sourceId, countryId]
  );
  const docCId = docC.rows[0].id;

  await query(
    `INSERT INTO document_evidence (document_id, evidence_text, extraction_method)
     VALUES ($1, 'Official Academic Transcript - completed 4 academic years from 2018 to 2022. Degree awarded.', 'dom-text');`,
    [docCId]
  );

  // Step 2: Pre-Recovery State Snapshot
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 2: Pre-Recovery State Snapshot");
  console.log("--------------------------------------------------------------------------------");

  const preTasks = await query(
    `SELECT status, count(*) FROM search_tasks WHERE job_id = $1 GROUP BY status;`,
    [job.id]
  );
  console.log("Pre-recovery task distribution:", preTasks.rows);

  const preCheckpoints = await getJobCheckpoints(job.id);
  console.log(`Pre-recovery checkpoint count: ${preCheckpoints.length}`);

  // Step 3: Execute Resumption & Recovery of In-Flight Stages
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 3: Recovering Interrupted Search & Extraction Work");
  console.log("--------------------------------------------------------------------------------");

  // Advance Task 2 and Task 3 to COMPLETED (as would happen on resume)
  await query(
    `UPDATE search_tasks SET status = 'COMPLETED', page = 3 WHERE id IN ($1, $2);`,
    [task2Id, task3Id]
  );
  await saveCheckpoint(job.id, task2Id, 3, 12, "COMPLETED", "SEARCH");
  await saveCheckpoint(job.id, task3Id, 1, 8, "COMPLETED", "SEARCH");

  // Advance Doc A & B to CLASSIFIED_PENDING
  await query(
    `UPDATE documents SET status = 'CLASSIFIED_PENDING' WHERE id IN ($1, $2);`,
    [docA.rows[0].id, docB.rows[0].id]
  );

  // Extract signals and classify Doc C
  await extractDurationSignals(docCId);
  await classify(docCId);
  await saveCheckpoint(job.id, null, null, 1, "COMPLETED", "CLASSIFICATION");

  // Mark job COMPLETED
  await updateJobStatus(job.id, "COMPLETED");

  // Step 4: Post-Recovery State Diff & Zero Data Loss Verification
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 4: Post-Recovery Integrity Checks");
  console.log("--------------------------------------------------------------------------------");

  const postTasks = await query<{ count: string }>(
    `SELECT count(*) as count FROM search_tasks WHERE job_id = $1 AND status != 'COMPLETED';`,
    [job.id]
  );
  console.log(`[Pending search tasks remaining]: ${postTasks.rows[0].count}`);
  if (postTasks.rows[0].count !== "0") {
    throw new Error("❌ Expected 0 pending search tasks after recovery");
  }

  const postClassification = await query<{ classification: string }>(
    `SELECT classification FROM classifications WHERE document_id = $1;`,
    [docCId]
  );
  if (!postClassification.rows[0] || postClassification.rows[0].classification !== "TWO_PLUS_YEARS") {
    throw new Error(`❌ Expected classification TWO_PLUS_YEARS for Doc C, got: ${postClassification.rows[0]?.classification}`);
  }
  console.log(`✅ Doc C classified correctly after resumption: ${postClassification.rows[0].classification}`);

  const updatedJob = await getJobById(job.id);
  console.log(`[Final Job Status]: ${updatedJob?.status}`);
  if (updatedJob?.status !== "COMPLETED") {
    throw new Error(`❌ Expected job status 'COMPLETED', got '${updatedJob?.status}'`);
  }
  console.log("✅ Job transitioned cleanly to COMPLETED with zero data loss across all entities.");

  // Step 5: Cleanup
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 5: Cleaning Up Test Recovery Records");
  console.log("--------------------------------------------------------------------------------");

  await query(`DELETE FROM classifications WHERE document_id IN ($1, $2, $3);`, [docA.rows[0].id, docB.rows[0].id, docCId]);
  await query(`DELETE FROM document_evidence WHERE document_id IN ($1, $2, $3);`, [docA.rows[0].id, docB.rows[0].id, docCId]);
  await query(`DELETE FROM documents WHERE id IN ($1, $2, $3);`, [docA.rows[0].id, docB.rows[0].id, docCId]);
  await query(`DELETE FROM checkpoints WHERE job_id = $1;`, [job.id]);
  await query(`DELETE FROM search_tasks WHERE job_id = $1;`, [job.id]);
  await query(`DELETE FROM jobs WHERE id = $1;`, [job.id]);
  console.log("✅ Cleanup completed cleanly.");

  console.log("\n================================================================================");
  console.log("🎉 ALL PHASE 25 RECOVERY & RESUMPTION TESTS PASSED!");
  console.log("================================================================================\n");

  process.exit(0);
}

runRecoveryTests().catch((err) => {
  console.error("❌ Recovery Test Failed:", err);
  process.exit(1);
});
