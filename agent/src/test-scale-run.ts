import { query } from "./db/pool";
import { createJob, getJobById } from "./db/queries/jobs";
import { generateTasks } from "./planner/searchPlanner";
import { concurrencyController } from "./pipeline/concurrencyController";
import { JobConfig } from "./schemas/jobConfig";

async function runScaleTests() {
  console.log("================================================================================");
  console.log("🧪 PHASE 24 — Multi-Country Scale Execution Test Suite");
  console.log("================================================================================\n");

  // Step 1: Query All Accepted Countries
  console.log("--------------------------------------------------------------------------------");
  console.log("Step 1: Fetching All Accepted Target Countries from Database");
  console.log("--------------------------------------------------------------------------------");

  const countryRows = await query<{ id: number; name: string }>(
    `SELECT id, name FROM countries WHERE is_accepted = true ORDER BY name ASC;`
  );
  const countryNames = countryRows.rows.map((c) => c.name);
  console.log(`✅ Loaded ${countryNames.length} accepted countries from database:`);
  console.log(`   [${countryNames.slice(0, 8).join(", ")}, ... and ${countryNames.length - 8} more]`);

  if (countryNames.length < 47) {
    throw new Error(`❌ Expected at least 47 accepted countries, found ${countryNames.length}`);
  }

  // Step 2: Create a Single Job with All 49 Countries
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 2: Creating a Single Scale Job Across All 49 Countries");
  console.log("--------------------------------------------------------------------------------");

  const scaleConfig: JobConfig = {
    source: "slideshare",
    countries: countryNames,
    education_levels: ["Bachelor", "Master", "Diploma", "Certificate"],
    document_types: ["Transcript", "Academic Record"],
    minimum_completed_years: 2.0,
    max_pages_per_search: 10,
  };

  const job = await createJob(scaleConfig);
  console.log(`✅ Scale Job created in database: ID=${job.id}, Status=${job.status}`);

  // Step 3: Plan Search Tasks for 49 Countries
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 3: Generating Deterministic Search Plan (49 Countries × 8 Variations)");
  console.log("--------------------------------------------------------------------------------");

  const startTime = Date.now();
  const planResult = await generateTasks(job.id, scaleConfig);
  const durationMs = Date.now() - startTime;

  console.log(`✅ Planned ${planResult.createdCount} search tasks across ${planResult.countriesPlanned.length} countries in ${durationMs}ms`);
  const expectedTaskCount = countryNames.length * (scaleConfig.education_levels.length * scaleConfig.document_types.length);
  console.log(`   (Expected: ${expectedTaskCount} tasks, Created: ${planResult.createdCount})`);

  if (planResult.createdCount !== expectedTaskCount) {
    throw new Error(`❌ Task count mismatch: expected ${expectedTaskCount}, got ${planResult.createdCount}`);
  }

  // Step 4: Verify Concurrency Controller Semantics under Parallel Load
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 4: Testing ConcurrencyController Semaphore Limiting");
  console.log("--------------------------------------------------------------------------------");

  const activeWorkerLog: number[] = [];
  let peakParallelWorkers = 0;

  // Simulate 12 concurrent workers requesting slots for 'slideshare' (limit is 2)
  const workerPromises = Array.from({ length: 12 }).map(async (_, idx) => {
    await concurrencyController.acquire("slideshare");
    const running = concurrencyController.getRunningCount("slideshare");
    peakParallelWorkers = Math.max(peakParallelWorkers, running);
    activeWorkerLog.push(running);

    // Simulate work delay
    await new Promise((r) => setTimeout(r, 40));

    concurrencyController.release("slideshare");
  });

  await Promise.all(workerPromises);

  console.log(`[Concurrency Stats]: Max configured limit for 'slideshare'=2, Observed peak parallel workers=${peakParallelWorkers}`);
  if (peakParallelWorkers > 2) {
    throw new Error(`❌ ConcurrencyController violated slot limit: observed ${peakParallelWorkers} > 2`);
  }
  console.log("✅ ConcurrencyController strictly capped parallel execution to configured limit.");

  // Step 5: Record Scale Run Metrics
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 5: Recording Scale Run Execution Metrics in Database");
  console.log("--------------------------------------------------------------------------------");

  const heapUsedMb = Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;
  await query(
    `INSERT INTO job_metrics (job_id, stage, duration_ms, items_processed, memory_heap_used_mb)
     VALUES ($1, 'PLANNING_49_COUNTRIES', $2, $3, $4);`,
    [job.id, durationMs, planResult.createdCount, heapUsedMb]
  );
  console.log(`✅ Inserted job_metrics row: Stage='PLANNING_49_COUNTRIES', Duration=${durationMs}ms, HeapUsed=${heapUsedMb}MB`);

  // Step 6: Cleanup
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 6: Cleaning Up Test Scale Job");
  console.log("--------------------------------------------------------------------------------");

  await query(`DELETE FROM job_metrics WHERE job_id = $1;`, [job.id]);
  await query(`DELETE FROM search_tasks WHERE job_id = $1;`, [job.id]);
  await query(`DELETE FROM jobs WHERE id = $1;`, [job.id]);
  console.log("✅ Scale job and 392 tasks cleaned up cleanly.");

  console.log("\n================================================================================");
  console.log("🎉 ALL PHASE 24 MULTI-COUNTRY SCALE TESTS PASSED!");
  console.log("================================================================================\n");

  process.exit(0);
}

runScaleTests().catch((err) => {
  console.error("❌ Scale Test Failed:", err);
  process.exit(1);
});
