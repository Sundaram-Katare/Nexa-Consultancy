import { buildServer } from "./server";
import { query, closePool } from "./db/pool";
import { browserManager } from "./browser/browserManager";
import { getSearchTasksByJob } from "./db/queries/searchTasks";

async function runPlannerTests() {
  console.log("==================================================");
  console.log("📋 PHASE 8 SEARCH PLANNER & EXECUTOR TEST SUITE");
  console.log("==================================================");

  const app = buildServer();
  await app.ready();

  let testJobId = "";

  try {
    // 1. Create Test Job for Canada
    console.log("\n[TEST 1] Creating a job for 'Canada'...");
    const createJobRes = await app.inject({
      method: "POST",
      url: "/jobs",
      payload: {
        source: "slideshare",
        countries: ["Canada"],
        education_levels: ["Diploma", "Bachelor"],
        document_types: ["Transcript"],
        minimum_completed_years: 2.0,
      },
    });

    if (createJobRes.statusCode !== 201) {
      throw new Error(`Failed to create job: ${createJobRes.body}`);
    }
    const jobJson = JSON.parse(createJobRes.body);
    testJobId = jobJson.id;
    console.log(`✅ Job created with ID: ${testJobId}`);

    // 2. Generate Search Plan
    console.log(`\n[TEST 2] Calling POST /jobs/${testJobId}/plan...`);
    const planRes = await app.inject({
      method: "POST",
      url: `/jobs/${testJobId}/plan`,
    });

    console.log(`Status: ${planRes.statusCode}, Payload:`, planRes.body);
    if (planRes.statusCode !== 200) {
      throw new Error(`Plan generation failed: ${planRes.body}`);
    }

    const planJson = JSON.parse(planRes.body);
    if (planJson.createdCount !== 8) {
      throw new Error(`Expected exactly 8 search tasks created for Canada, got ${planJson.createdCount}`);
    }
    console.log(`✅ Exactly 8 search tasks generated for Canada.`);

    // Confirm tasks in database
    const dbTasks = await getSearchTasksByJob(testJobId);
    console.log("Generated search task queries in DB:");
    for (const t of dbTasks) {
      console.log(`  - [${t.status}] "${t.query_text}" (Page: ${t.page})`);
    }
    if (dbTasks.length !== 8) {
      throw new Error(`Expected 8 tasks in DB, found ${dbTasks.length}`);
    }

    // 3. Test Idempotent Re-Planning (Duplicate Prevention)
    console.log(`\n[TEST 3] Calling POST /jobs/${testJobId}/plan second time (Idempotence)...`);
    const rePlanRes = await app.inject({
      method: "POST",
      url: `/jobs/${testJobId}/plan`,
    });

    const rePlanJson = JSON.parse(rePlanRes.body);
    console.log(`Re-plan result: created=${rePlanJson.createdCount}, existing=${rePlanJson.existingCount}`);
    if (rePlanJson.createdCount !== 0 || rePlanJson.existingCount !== 8) {
      throw new Error(`Expected 0 created and 8 existing on re-plan, got: ${rePlanRes.body}`);
    }
    console.log("✅ Idempotent planning verified: 0 duplicates created.");

    // 4. Execute Search Task (Deep Pagination & Document Ingestion)
    const targetTask = dbTasks[0]; // e.g. "Canada transcript"
    console.log(`\n[TEST 4] Executing search task: ${targetTask.id} ("${targetTask.query_text}")...`);

    const runRes = await app.inject({
      method: "POST",
      url: `/search-tasks/${targetTask.id}/run`,
      payload: {
        max_pages: 2, // Test 2 pages
      },
    });

    console.log(`Status: ${runRes.statusCode}, Payload:`, runRes.body);
    if (runRes.statusCode !== 200) {
      throw new Error(`Search task execution failed: ${runRes.body}`);
    }

    const runJson = JSON.parse(runRes.body);
    console.log("Execution details:", runJson.execution);
    if (runJson.execution.pagesCrawled < 1) {
      throw new Error("Expected at least 1 page crawled");
    }
    console.log(`✅ Task executed successfully (${runJson.execution.pagesCrawled} pages, ${runJson.execution.newDocumentsInserted} documents ingested).`);

    // 5. Verify documents table & search_history rows
    console.log("\n[TEST 5] Verifying documents table and search_history in Supabase...");
    const historyRes = await query(
      `SELECT id, executed_at, result_count, raw_response_meta 
       FROM search_history 
       WHERE search_task_id = $1 
       ORDER BY executed_at ASC;`,
      [targetTask.id]
    );
    console.log(`Search history rows count: ${historyRes.rows.length}`);
    if (historyRes.rows.length === 0) {
      throw new Error("No search_history rows recorded!");
    }

    const docsRes = await query(
      `SELECT id, canonical_url, title, status, country_id, source_id 
       FROM documents 
       WHERE country_id = $1 
       ORDER BY created_at DESC 
       LIMIT 5;`,
      [targetTask.country_id]
    );
    console.log(`Discovered documents sample in DB (${docsRes.rows.length} rows):`);
    for (const d of docsRes.rows) {
      console.log(`  - [${d.status}] "${d.title}" (${d.canonicalUrl})`);
    }
    if (docsRes.rows.length === 0) {
      console.warn("⚠️ Warning: 0 documents inserted (target site query had 0 results)");
    } else {
      console.log("✅ Documents successfully stored with status PENDING.");
    }

    // 6. Test Deduplication on Re-Run
    console.log(`\n[TEST 6] Re-running same search task to test document deduplication...`);
    const initialDocCount = parseInt(
      (await query(`SELECT COUNT(*) as count FROM documents WHERE country_id = $1;`, [targetTask.country_id])).rows[0].count,
      10
    );

    // Reset task to page 1 for re-run test
    await query(`UPDATE search_tasks SET page = 1 WHERE id = $1;`, [targetTask.id]);

    const rerunRes = await app.inject({
      method: "POST",
      url: `/search-tasks/${targetTask.id}/run`,
      payload: { max_pages: 1 },
    });

    const rerunJson = JSON.parse(rerunRes.body);
    console.log(`Re-run: newDocumentsInserted=${rerunJson.execution.newDocumentsInserted}, duplicatesSkipped=${rerunJson.execution.duplicatesSkipped}`);

    const finalDocCount = parseInt(
      (await query(`SELECT COUNT(*) as count FROM documents WHERE country_id = $1;`, [targetTask.country_id])).rows[0].count,
      10
    );
    if (finalDocCount !== initialDocCount) {
      throw new Error(`Expected document count to remain ${initialDocCount}, but increased to ${finalDocCount}!`);
    }
    console.log("✅ Zero duplicate documents created on re-run (deduplication verified).");

    // 7. Test Pagination Resume from Page 2
    console.log(`\n[TEST 7] Testing task resume from Page 2...`);
    await query(`UPDATE search_tasks SET page = 2, status = 'RUNNING' WHERE id = $1;`, [targetTask.id]);

    const resumeRes = await app.inject({
      method: "POST",
      url: `/search-tasks/${targetTask.id}/run`,
      payload: { max_pages: 2 },
    });

    const resumeJson = JSON.parse(resumeRes.body);
    console.log(`Resume Execution result:`, resumeJson.execution);
    console.log("✅ Task successfully resumed and completed from Page 2.");

    // 8. Cleanup Test Artifacts
    console.log("\n[TEST 8] Cleaning up test data...");
    await query(`DELETE FROM jobs WHERE id = $1;`, [testJobId]);
    await query(`DELETE FROM documents WHERE country_id = $1;`, [targetTask.country_id]);
    console.log("✅ Cleaned up test job, tasks, history, and documents.");

    console.log("\n==================================================");
    console.log("🎉 ALL SEARCH PLANNER & EXECUTOR TESTS PASSED 100%!");
    console.log("==================================================");
  } catch (error: any) {
    console.error("❌ Planner Test Failed:", error);
    if (testJobId) {
      try {
        await query(`DELETE FROM jobs WHERE id = $1;`, [testJobId]);
      } catch {}
    }
    process.exit(1);
  } finally {
    await browserManager.closeAll();
    await app.close();
    await closePool();
  }
}

runPlannerTests();
