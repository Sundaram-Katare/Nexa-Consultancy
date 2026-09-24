import { buildServer } from "./server";
import { query, closePool } from "./db/pool";
import { findSignalsInText } from "./evidence/patterns";
import {
  extractDurationSignals,
  extractDurationSignalsBatch,
  getEvidenceSignals,
} from "./evidence/evidenceExtractor";
import { insertDocumentEvidence } from "./db/queries/documents";

async function runEvidenceTests() {
  console.log("================================================================================");
  console.log("          NEXA CONSULTANCY — PHASE 12 EVIDENCE EXTRACTION TEST SUITE            ");
  console.log("================================================================================\n");

  const fastify = buildServer();
  await fastify.ready();

  const createdDocIds: string[] = [];

  try {
    // ============================================================================
    // TEST 1: Unit Tests on Pattern Matchers
    // ============================================================================
    console.log("[TEST 1] Testing pattern matchers for all 6 signal types...");

    // 1A: DATE_RANGE
    const s1 = findSignalsInText("Enrolled from Sep 2018 to Jun 2022 at university.");
    console.log("- 1A (Date Range):", s1);
    if (!s1.some((s) => s.signalType === "DATE_RANGE" && s.extractedValue === "2018 - 2022")) {
      throw new Error(`Expected DATE_RANGE '2018 - 2022', got ${JSON.stringify(s1)}`);
    }

    // 1B: DURATION_STATEMENT
    const s2 = findSignalsInText("Official record. Duration of study: 3 years full time.");
    console.log("- 1B (Duration Statement):", s2);
    if (!s2.some((s) => s.signalType === "DURATION_STATEMENT")) {
      throw new Error(`Expected DURATION_STATEMENT, got ${JSON.stringify(s2)}`);
    }

    // 1C: YEAR_COUNT
    const s3 = findSignalsInText("The candidate successfully completed 3 academic years of study.");
    console.log("- 1C (Year Count):", s3);
    if (!s3.some((s) => s.signalType === "YEAR_COUNT")) {
      throw new Error(`Expected YEAR_COUNT, got ${JSON.stringify(s3)}`);
    }

    // 1D: SEMESTER_COUNT (Must NOT be tagged as YEAR_COUNT)
    const s4 = findSignalsInText("Passed all examinations for completed 6 semesters of coursework.");
    console.log("- 1D (Semester Count):", s4);
    if (!s4.some((s) => s.signalType === "SEMESTER_COUNT")) {
      throw new Error(`Expected SEMESTER_COUNT, got ${JSON.stringify(s4)}`);
    }
    if (s4.some((s) => s.signalType === "YEAR_COUNT")) {
      throw new Error("CRITICAL: SEMESTER_COUNT was incorrectly conflated as YEAR_COUNT!");
    }

    // 1E: PROGRAM_LENGTH (Must NOT be tagged as YEAR_COUNT)
    const s5 = findSignalsInText("Admitted into the 4-year Bachelor of Science degree program.");
    console.log("- 1E (Program Length):", s5);
    if (!s5.some((s) => s.signalType === "PROGRAM_LENGTH")) {
      throw new Error(`Expected PROGRAM_LENGTH, got ${JSON.stringify(s5)}`);
    }
    if (s5.some((s) => s.signalType === "YEAR_COUNT")) {
      throw new Error("CRITICAL: PROGRAM_LENGTH was incorrectly conflated as completed YEAR_COUNT!");
    }

    // 1F: GRADUATION_STATEMENT
    const s6 = findSignalsInText("The degree of Bachelor of Arts was conferred on June 15, 2021.");
    console.log("- 1F (Graduation Statement):", s6);
    if (!s6.some((s) => s.signalType === "GRADUATION_STATEMENT")) {
      throw new Error(`Expected GRADUATION_STATEMENT, got ${JSON.stringify(s6)}`);
    }

    console.log("✅ [TEST 1 PASSED] All 6 pattern types extract accurately with zero conflation.");

    // ============================================================================
    // TEST 2: Seed Documents and Execute Single & Batch Extraction
    // ============================================================================
    console.log("\n[TEST 2] Testing batch and single evidence extraction pipeline...");

    // Doc 1: Real transcript with multi-signal evidence
    const res1 = await query(
      `INSERT INTO documents (source_id, canonical_url, title, country_id, status)
       VALUES (2, 'https://slideshare.net/test_evidence_transcript_1', 'Academic Transcript - University of Pittsburgh', 1, 'CLASSIFIED_PENDING')
       RETURNING id;`
    );
    const doc1Id = res1.rows[0].id;
    createdDocIds.push(doc1Id);
    await insertDocumentEvidence(doc1Id, [
      "Official Academic Record. Session: 2017 - 2021",
      "Completed 8 semesters of undergraduate coursework with GPA 3.82",
      "Degree conferred on May 2021: Bachelor of Science in Nutrition",
    ]);

    // Doc 2: Only Program Length (e.g. 3-year diploma, no completion)
    const res2 = await query(
      `INSERT INTO documents (source_id, canonical_url, title, country_id, status)
       VALUES (2, 'https://slideshare.net/test_evidence_prog_length_only', 'Program Handbook - 3-Year Diploma', 1, 'CLASSIFIED_PENDING')
       RETURNING id;`
    );
    const doc2Id = res2.rows[0].id;
    createdDocIds.push(doc2Id);
    await insertDocumentEvidence(doc2Id, [
      "This curriculum outlines the standard 3-year diploma course structure.",
      "Department of Mechanical Engineering course catalog and syllabus overview.",
    ]);

    // Doc 3: Genuinely NO duration-relevant signals
    const res3 = await query(
      `INSERT INTO documents (source_id, canonical_url, title, country_id, status)
       VALUES (2, 'https://slideshare.net/test_evidence_no_duration', 'Campus Map and Library Hours', 1, 'CLASSIFIED_PENDING')
       RETURNING id;`
    );
    const doc3Id = res3.rows[0].id;
    createdDocIds.push(doc3Id);
    await insertDocumentEvidence(doc3Id, [
      "The university library is open Monday through Friday from 8am to 10pm.",
      "Campus shuttle stops at North Hall, Science Center, and Main Dining.",
    ]);

    // Call Batch API route POST /documents/extract-evidence-batch?sourceId=slideshare&limit=10
    console.log("\n[TEST 3] Calling POST /documents/extract-evidence-batch?sourceId=slideshare&limit=10...");
    const batchRes = await fastify.inject({
      method: "POST",
      url: "/documents/extract-evidence-batch?sourceId=slideshare&limit=10",
    });

    console.log(`- Batch API status: ${batchRes.statusCode}`);
    if (batchRes.statusCode !== 200) {
      throw new Error(`Batch evidence extraction API failed: ${batchRes.body}`);
    }

    const batchJson = JSON.parse(batchRes.body);
    console.log("- Batch Extraction Result Summary:", {
      totalDocs: batchJson.data.totalProcessed,
      totalSignals: batchJson.data.totalSignalsExtracted,
    });

    // ============================================================================
    // TEST 4: Assert Extracted Signals for Each Document
    // ============================================================================
    console.log("\n[TEST 4] Verifying evidence_signals table in Supabase...");

    // Doc 1 signals verification
    const doc1Signals = await getEvidenceSignals(doc1Id);
    console.log(`- Doc 1 (Full Transcript) signals count: ${doc1Signals.length}`);
    console.log("  Signals:", doc1Signals.map((s) => `[${s.signal_type}]: "${s.raw_text}" (${s.extracted_value})`));
    if (doc1Signals.length < 3) {
      throw new Error(`Expected at least 3 signals for Doc 1, found ${doc1Signals.length}`);
    }
    const hasDateRange = doc1Signals.some((s) => s.signal_type === "DATE_RANGE");
    const hasSemester = doc1Signals.some((s) => s.signal_type === "SEMESTER_COUNT");
    const hasGrad = doc1Signals.some((s) => s.signal_type === "GRADUATION_STATEMENT");
    if (!hasDateRange || !hasSemester || !hasGrad) {
      throw new Error("Doc 1 missing expected DATE_RANGE, SEMESTER_COUNT, or GRADUATION_STATEMENT signals!");
    }

    // Doc 2 signals verification (Program length only, NOT year count)
    const doc2Signals = await getEvidenceSignals(doc2Id);
    console.log(`- Doc 2 (Program Length Only) signals count: ${doc2Signals.length}`);
    console.log("  Signals:", doc2Signals.map((s) => `[${s.signal_type}]: "${s.raw_text}"`));
    if (doc2Signals.length !== 1 || doc2Signals[0].signal_type !== "PROGRAM_LENGTH") {
      throw new Error(`Expected exactly 1 PROGRAM_LENGTH signal for Doc 2, got: ${JSON.stringify(doc2Signals)}`);
    }

    // Doc 3 signals verification (Genuinely NO duration signals)
    const doc3Signals = await getEvidenceSignals(doc3Id);
    console.log(`- Doc 3 (No Duration) signals count: ${doc3Signals.length}`);
    if (doc3Signals.length !== 0) {
      throw new Error(`Expected exactly 0 signals for Doc 3, found ${doc3Signals.length}: ${JSON.stringify(doc3Signals)}`);
    }

    console.log("✅ [TEST 4 PASSED] All documents verified: signals matched reality, program length isolated, empty sets unforced.");

    // ============================================================================
    // TEST 5: Single Document Routes & Idempotent Re-Extraction
    // ============================================================================
    console.log("\n[TEST 5] Testing GET /documents/:id/signals and idempotent re-extraction...");
    const getSignalsRes = await fastify.inject({
      method: "GET",
      url: `/documents/${doc1Id}/signals`,
    });
    if (getSignalsRes.statusCode !== 200) {
      throw new Error(`GET signals failed: ${getSignalsRes.body}`);
    }
    const getSignalsJson = JSON.parse(getSignalsRes.body);
    if (getSignalsJson.signalsCount !== doc1Signals.length) {
      throw new Error(`GET /signals returned ${getSignalsJson.signalsCount}, expected ${doc1Signals.length}`);
    }

    // Re-run single extraction on Doc 1
    console.log("- Re-running POST /documents/:id/extract-evidence on Doc 1 (Idempotency test)...");
    const reExtractRes = await fastify.inject({
      method: "POST",
      url: `/documents/${doc1Id}/extract-evidence`,
    });
    if (reExtractRes.statusCode !== 200) {
      throw new Error(`Re-extraction failed: ${reExtractRes.body}`);
    }
    const reDoc1Signals = await getEvidenceSignals(doc1Id);
    if (reDoc1Signals.length !== doc1Signals.length) {
      throw new Error(`Idempotency violated: signals count increased from ${doc1Signals.length} to ${reDoc1Signals.length}!`);
    }
    console.log("✅ [TEST 5 PASSED] Extraction is strictly idempotent with zero duplicate signals inserted on re-run.");

    console.log("\n================================================================================");
    console.log("         🎉 ALL PHASE 12 EVIDENCE EXTRACTION TESTS PASSED 100%!                 ");
    console.log("================================================================================\n");
  } catch (err: any) {
    console.error("\n❌ [FATAL EVIDENCE TEST FAILURE]:", err);
    process.exitCode = 1;
  } finally {
    // Cleanup test fixtures
    console.log("[CLEANUP] Cleaning up test fixtures from Supabase...");
    if (createdDocIds.length > 0) {
      try {
        await query(`DELETE FROM documents WHERE id = ANY($1);`, [createdDocIds]);
        console.log(`[CLEANUP] Deleted ${createdDocIds.length} test documents.`);
      } catch (e: any) {
        console.warn("[CLEANUP] Error deleting test documents:", e.message);
      }
    }
    await fastify.close();
    await closePool();
    process.exit(process.exitCode || 0);
  }
}

runEvidenceTests();
