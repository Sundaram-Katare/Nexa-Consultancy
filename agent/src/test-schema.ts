import { pool, query, closePool } from "./db/pool";

async function runTests() {
  console.log("==================================================");
  console.log("🔍 PHASE 2 SCHEMA & CONSTRAINT VERIFICATION SUITE");
  console.log("==================================================");

  try {
    // 0. Pre-clean any test artifacts from prior runs
    await query(`
      DELETE FROM classifications 
      WHERE document_id IN (
        SELECT id FROM documents WHERE source_document_id LIKE 'SCRIBD-DOC-999%'
      );
    `);
    await query(`DELETE FROM documents WHERE source_document_id LIKE 'SCRIBD-DOC-999%';`);
    await query(`DELETE FROM jobs WHERE config->>'test' = 'true';`);

    // 1. Check Tables Exist
    console.log("\n[TEST 1] Checking all tables exist in Supabase...");
    const tablesRes = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    const tables = tablesRes.rows.map((r) => r.table_name);
    console.log("Found tables:", tables.join(", "));

    const requiredTables = [
      "countries",
      "sources",
      "jobs",
      "search_tasks",
      "search_history",
      "documents",
      "document_evidence",
      "classifications",
      "checkpoints",
      "errors",
      "audit_logs",
    ];

    for (const req of requiredTables) {
      if (!tables.includes(req)) {
        throw new Error(`Missing required table: ${req}`);
      }
    }
    console.log("✅ All required tables exist.");

    // 2. Check Seed Data (Countries & Sources)
    console.log("\n[TEST 2] Checking seeded countries and sources...");
    const countriesRes = await query(`SELECT COUNT(*) as count FROM countries;`);
    const countryCount = parseInt(countriesRes.rows[0].count, 10);
    console.log(`Seeded countries count: ${countryCount}`);
    if (countryCount < 47) {
      throw new Error(`Expected at least 47 countries, found ${countryCount}`);
    }

    const sourcesRes = await query(`SELECT name FROM sources;`);
    console.log("Seeded sources:", sourcesRes.rows.map((s) => s.name).join(", "));
    console.log("✅ Countries and sources seeded correctly.");

    // 3. Test Foreign Keys & Unique Constraint on search_tasks
    console.log("\n[TEST 3] Testing search_tasks duplicate prevention unique constraint...");
    const jobRes = await query(
      `INSERT INTO jobs (status, config) VALUES ($1, $2) RETURNING id;`,
      ["QUEUED", { test: true }]
    );
    const jobId = jobRes.rows[0].id;
    const sourceRes = await query(`SELECT id FROM sources WHERE name = 'scribd';`);
    const sourceId = sourceRes.rows[0].id;
    const countrySample = await query(`SELECT id FROM countries WHERE name = 'Canada';`);
    const countryId = countrySample.rows[0].id;

    await query(
      `INSERT INTO search_tasks (job_id, country_id, source_id, query_text, page, status) 
       VALUES ($1, $2, $3, $4, $5, $6);`,
      [jobId, countryId, sourceId, "Canada University Transcript", 1, "QUEUED"]
    );
    console.log("Inserted primary search task.");

    let duplicateSearchTaskRejected = false;
    try {
      await query(
        `INSERT INTO search_tasks (job_id, country_id, source_id, query_text, page, status) 
         VALUES ($1, $2, $3, $4, $5, $6);`,
        [jobId, countryId, sourceId, "Canada University Transcript", 1, "QUEUED"]
      );
    } catch (err: any) {
      if (err.code === "23505") {
        duplicateSearchTaskRejected = true;
        console.log("✅ Correctly rejected duplicate search task (23505 unique_violation).");
      } else {
        throw err;
      }
    }
    if (!duplicateSearchTaskRejected) {
      throw new Error("Failed to reject duplicate search task!");
    }

    // 4. Test Documents Unique Constraint on (source_id, source_document_id)
    console.log("\n[TEST 4] Testing documents source_document_id deduplication...");
    const docRes = await query(
      `INSERT INTO documents (source_id, source_document_id, canonical_url, title, country_id) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id;`,
      [sourceId, "SCRIBD-DOC-99901", "https://www.scribd.com/doc/99901", "Sample Transcript", countryId]
    );
    const docId = docRes.rows[0].id;

    let duplicateDocRejected = false;
    try {
      await query(
        `INSERT INTO documents (source_id, source_document_id, canonical_url, title, country_id) 
         VALUES ($1, $2, $3, $4, $5);`,
        [sourceId, "SCRIBD-DOC-99901", "https://www.scribd.com/doc/99901-diff", "Sample Transcript 2", countryId]
      );
    } catch (err: any) {
      if (err.code === "23505") {
        duplicateDocRejected = true;
        console.log("✅ Correctly rejected duplicate (source_id, source_document_id).");
      } else {
        throw err;
      }
    }
    if (!duplicateDocRejected) {
      throw new Error("Failed to reject duplicate document!");
    }

    // 5. Test Classifications CHECK Constraint & Foreign Key Protection
    console.log("\n[TEST 5] Testing classifications CHECK constraint...");
    // Valid insert
    await query(
      `INSERT INTO classifications (document_id, classification, completed_years, confidence) 
       VALUES ($1, $2, $3, $4);`,
      [docId, "TWO_PLUS_YEARS", 2.0, 0.98]
    );
    console.log("Valid classification inserted.");

    // Invalid insert
    let invalidCheckRejected = false;
    const doc2Res = await query(
      `INSERT INTO documents (source_id, source_document_id, canonical_url, title, country_id) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id;`,
      [sourceId, "SCRIBD-DOC-99902", "https://www.scribd.com/doc/99902", "Sample Transcript 2", countryId]
    );
    const doc2Id = doc2Res.rows[0].id;

    try {
      await query(
        `INSERT INTO classifications (document_id, classification, completed_years, confidence) 
         VALUES ($1, $2, $3, $4);`,
        [doc2Id, "INVALID_ENUM_VALUE", 1.0, 0.5]
      );
    } catch (err: any) {
      if (err.code === "23514") {
        invalidCheckRejected = true;
        console.log("✅ Correctly rejected invalid classification enum (23514 check_violation).");
      } else {
        throw err;
      }
    }
    if (!invalidCheckRejected) {
      throw new Error("Failed to reject invalid classification value!");
    }

    // 6. Test ON DELETE RESTRICT on documents -> classifications
    console.log("\n[TEST 6] Testing ON DELETE RESTRICT on documents -> classifications...");
    let restrictWorked = false;
    try {
      await query(`DELETE FROM documents WHERE id = $1;`, [docId]);
    } catch (err: any) {
      if (err.code === "23503") {
        restrictWorked = true;
        console.log("✅ Correctly prevented document deletion while classification exists (23503 ON DELETE RESTRICT).");
      } else {
        throw err;
      }
    }
    if (!restrictWorked) {
      throw new Error("Failed to enforce ON DELETE RESTRICT!");
    }

    // 7. Cleanup test data in proper order
    console.log("\n[TEST 7] Cleaning up test rows in proper dependency order...");
    await query(`DELETE FROM classifications WHERE document_id = $1;`, [docId]);
    await query(`DELETE FROM documents WHERE id IN ($1, $2);`, [docId, doc2Id]);
    await query(`DELETE FROM jobs WHERE id = $1;`, [jobId]);
    console.log("✅ Cleaned up test rows cleanly.");

    console.log("\n==================================================");
    console.log("🎉 ALL SCHEMA & CONSTRAINT TESTS PASSED 100%!");
    console.log("==================================================");
  } catch (error: any) {
    console.error("❌ Schema Test Failed:", error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

runTests();
