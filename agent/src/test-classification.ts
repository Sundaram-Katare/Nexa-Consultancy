import { buildServer } from "./server";
import { query, closePool } from "./db/pool";
import { candidateClassification } from "./classification/rules";
import {
  classify,
  classifyBatch,
  getDocumentClassification,
} from "./classification/classificationEngine";
import { extractDurationSignals } from "./evidence/evidenceExtractor";
import { insertDocumentEvidence } from "./db/queries/documents";

async function runClassificationTests() {
  console.log("================================================================================");
  console.log("       NEXA CONSULTANCY — PHASE 13 2-YEAR CLASSIFICATION TEST SUITE             ");
  console.log("================================================================================\n");

  const fastify = buildServer();
  await fastify.ready();

  const createdDocIds: string[] = [];

  try {
    // ============================================================================
    // TEST 1: Unit Tests on Classification Rules (All 6 Rules + Anti-Hallucination)
    // ============================================================================
    console.log("[TEST 1] Testing candidateClassification rules & anti-hallucination logic...");

    // Rule 1A: Clean Date Range >= 2 years -> TWO_PLUS_YEARS
    const r1A = candidateClassification([
      {
        id: "1",
        document_id: "doc1",
        document_evidence_id: null,
        signal_type: "DATE_RANGE",
        raw_text: "Session: 2017 - 2021",
        extracted_value: "2017 - 2021",
        location_ref: "block_1",
        created_at: new Date().toISOString(),
      },
    ]);
    console.log("- 1A (Date Range 4 yrs):", r1A);
    if (r1A.classification !== "TWO_PLUS_YEARS" || r1A.completedYears !== 4) {
      throw new Error(`Expected TWO_PLUS_YEARS with 4 years, got ${JSON.stringify(r1A)}`);
    }

    // Rule 1B: Clean Date Range < 2 years -> LESS_THAN_TWO_YEARS
    const r1B = candidateClassification([
      {
        id: "2",
        document_id: "doc2",
        document_evidence_id: null,
        signal_type: "DATE_RANGE",
        raw_text: "Academic Year: 2020 - 2021",
        extracted_value: "2020 - 2021",
        location_ref: "block_1",
        created_at: new Date().toISOString(),
      },
    ]);
    console.log("- 1B (Date Range 1 yr):", r1B);
    if (r1B.classification !== "LESS_THAN_TWO_YEARS" || r1B.completedYears !== 1) {
      throw new Error(`Expected LESS_THAN_TWO_YEARS with 1 year, got ${JSON.stringify(r1B)}`);
    }

    // Rule 2: Explicit Completed Years -> TWO_PLUS_YEARS
    const r2 = candidateClassification([
      {
        id: "3",
        document_id: "doc3",
        document_evidence_id: null,
        signal_type: "YEAR_COUNT",
        raw_text: "The student successfully completed 3 academic years",
        extracted_value: "completed 3 academic years",
        location_ref: "block_2",
        created_at: new Date().toISOString(),
      },
    ]);
    console.log("- Rule 2 (Explicit 3 Years):", r2);
    if (r2.classification !== "TWO_PLUS_YEARS" || r2.completedYears !== 3) {
      throw new Error(`Expected TWO_PLUS_YEARS with 3 years, got ${JSON.stringify(r2)}`);
    }

    // Rule 3: Semester Count only -> NEEDS_REVIEW (No guessing)
    const r3 = candidateClassification([
      {
        id: "4",
        document_id: "doc4",
        document_evidence_id: null,
        signal_type: "SEMESTER_COUNT",
        raw_text: "Completed 6 semesters of study",
        extracted_value: "completed 6 semesters",
        location_ref: "block_1",
        created_at: new Date().toISOString(),
      },
    ]);
    console.log("- Rule 3 (Semester Only):", r3);
    if (r3.classification !== "NEEDS_REVIEW" || r3.reasoning !== "semester_count_without_year_confirmation") {
      throw new Error(`Expected NEEDS_REVIEW with semester_count_without_year_confirmation, got ${JSON.stringify(r3)}`);
    }

    // Rule 4A: Program Length only -> NEEDS_REVIEW (Do NOT infer completed years from program length)
    const r4A = candidateClassification([
      {
        id: "5",
        document_id: "doc5",
        document_evidence_id: null,
        signal_type: "PROGRAM_LENGTH",
        raw_text: "Enrolled in 4-year Bachelor degree program",
        extracted_value: "4-year Bachelor",
        location_ref: "block_1",
        created_at: new Date().toISOString(),
      },
    ]);
    console.log("- Rule 4A (Program Length Only):", r4A);
    if (r4A.classification !== "NEEDS_REVIEW" || r4A.reasoning !== "program_length_not_completed_duration") {
      throw new Error(`Expected NEEDS_REVIEW with program_length_not_completed_duration, got ${JSON.stringify(r4A)}`);
    }

    // Rule 4B: Graduation Statement only -> NEEDS_REVIEW
    const r4B = candidateClassification([
      {
        id: "6",
        document_id: "doc6",
        document_evidence_id: null,
        signal_type: "GRADUATION_STATEMENT",
        raw_text: "Degree of Bachelor of Science was conferred on June 15, 2021",
        extracted_value: "degree conferred on June 15, 2021",
        location_ref: "block_1",
        created_at: new Date().toISOString(),
      },
    ]);
    console.log("- Rule 4B (Graduation Statement Only):", r4B);
    if (r4B.classification !== "NEEDS_REVIEW" || r4B.reasoning !== "graduation_without_duration_evidence") {
      throw new Error(`Expected NEEDS_REVIEW with graduation_without_duration_evidence, got ${JSON.stringify(r4B)}`);
    }

    // Conflict Check: Contradicting Date Ranges -> NEEDS_REVIEW ('conflicting_evidence')
    const rConflict = candidateClassification([
      {
        id: "7",
        document_id: "doc7",
        document_evidence_id: null,
        signal_type: "DATE_RANGE",
        raw_text: "Attendance Period: 2018 - 2020",
        extracted_value: "2018 - 2020", // 2 years
        location_ref: "block_1",
        created_at: new Date().toISOString(),
      },
      {
        id: "8",
        document_id: "doc7",
        document_evidence_id: null,
        signal_type: "DATE_RANGE",
        raw_text: "Degree Years: 2018 - 2022",
        extracted_value: "2018 - 2022", // 4 years
        location_ref: "block_2",
        created_at: new Date().toISOString(),
      },
    ]);
    console.log("- Conflict Check (Contradicting Dates):", rConflict);
    if (rConflict.classification !== "NEEDS_REVIEW" || rConflict.reasoning !== "conflicting_evidence") {
      throw new Error(`Expected NEEDS_REVIEW with conflicting_evidence, got ${JSON.stringify(rConflict)}`);
    }

    // Rule 5: Zero evidence signals -> NEEDS_REVIEW ('no_evidence_found')
    const r5 = candidateClassification([]);
    console.log("- Rule 5 (Zero Signals):", r5);
    if (r5.classification !== "NEEDS_REVIEW" || r5.reasoning !== "no_evidence_found") {
      throw new Error(`Expected NEEDS_REVIEW with no_evidence_found, got ${JSON.stringify(r5)}`);
    }

    console.log("✅ [TEST 1 PASSED] All classification rules and conflict guards passed.");

    // ============================================================================
    // TEST 2: Database & API Integration on Seeded Documents
    // ============================================================================
    console.log("\n[TEST 2] Seeding test documents for single and batch classification API...");

    // Doc 1: 4-Year Transcript -> TWO_PLUS_YEARS
    const res1 = await query(
      `INSERT INTO documents (source_id, canonical_url, title, country_id, status)
       VALUES (2, 'https://slideshare.net/test_class_4yr_transcript', 'Official Academic Transcript - Bachelor of Science', 1, 'CLASSIFIED_PENDING')
       RETURNING id;`
    );
    const doc1Id = res1.rows[0].id;
    createdDocIds.push(doc1Id);
    await insertDocumentEvidence(doc1Id, [
      "Official Transcript of Academic Record. Session: 2017 - 2021",
      "Completed 8 semesters of study with GPA 3.82",
    ]);
    await extractDurationSignals(doc1Id);

    // Doc 2: 1-Year Certificate -> LESS_THAN_TWO_YEARS
    const res2 = await query(
      `INSERT INTO documents (source_id, canonical_url, title, country_id, status)
       VALUES (2, 'https://slideshare.net/test_class_1yr_cert', 'Certificate of Completion - 1 Year Study', 1, 'CLASSIFIED_PENDING')
       RETURNING id;`
    );
    const doc2Id = res2.rows[0].id;
    createdDocIds.push(doc2Id);
    await insertDocumentEvidence(doc2Id, [
      "Attendance Period: 2020 - 2021. Successfully completed 1 academic year.",
    ]);
    await extractDurationSignals(doc2Id);

    // Doc 3: Semester Count Only -> NEEDS_REVIEW
    const res3 = await query(
      `INSERT INTO documents (source_id, canonical_url, title, country_id, status)
       VALUES (2, 'https://slideshare.net/test_class_semester_only', 'Student Grade Sheet - Semester Record', 1, 'CLASSIFIED_PENDING')
       RETURNING id;`
    );
    const doc3Id = res3.rows[0].id;
    createdDocIds.push(doc3Id);
    await insertDocumentEvidence(doc3Id, [
      "Student examination marks for completed 6 semesters of coursework.",
    ]);
    await extractDurationSignals(doc3Id);

    // Doc 4: Conflicting Dates -> NEEDS_REVIEW ('conflicting_evidence')
    const res4 = await query(
      `INSERT INTO documents (source_id, canonical_url, title, country_id, status)
       VALUES (2, 'https://slideshare.net/test_class_conflicting_dates', 'Transcript with Discrepancy', 1, 'CLASSIFIED_PENDING')
       RETURNING id;`
    );
    const doc4Id = res4.rows[0].id;
    createdDocIds.push(doc4Id);
    await insertDocumentEvidence(doc4Id, [
      "Initial registration period: 2018 - 2020",
      "Revised transcript period: 2018 - 2023",
    ]);
    await extractDurationSignals(doc4Id);

    // ============================================================================
    // TEST 3: Single Document Classification Route (POST /documents/:id/classify)
    // ============================================================================
    console.log("\n[TEST 3] Calling POST /documents/:id/classify on Doc 1 (4-Year Transcript)...");
    const classifyRes = await fastify.inject({
      method: "POST",
      url: `/documents/${doc1Id}/classify`,
    });

    console.log(`- Status: ${classifyRes.statusCode}`);
    if (classifyRes.statusCode !== 200) {
      throw new Error(`Single classification failed: ${classifyRes.body}`);
    }
    const classifyJson = JSON.parse(classifyRes.body);
    console.log("- Classification Data:", classifyJson.data);
    if (
      classifyJson.data.classification !== "TWO_PLUS_YEARS" ||
      Number(classifyJson.data.completed_years) !== 4
    ) {
      throw new Error(`Expected TWO_PLUS_YEARS with 4 completed_years, got: ${JSON.stringify(classifyJson.data)}`);
    }

    // Verify document status changed to 'CLASSIFIED'
    const doc1Db = (await query(`SELECT status FROM documents WHERE id = $1;`, [doc1Id])).rows[0];
    console.log(`- Document status in DB: ${doc1Db.status}`);
    if (doc1Db.status !== "CLASSIFIED") {
      throw new Error(`Expected document status CLASSIFIED, got ${doc1Db.status}`);
    }
    console.log("✅ [TEST 3 PASSED] Single document classification executed and status advanced to CLASSIFIED.");

    // ============================================================================
    // TEST 4: Batch Classification Route (POST /documents/classify-batch)
    // ============================================================================
    console.log("\n[TEST 4] Calling POST /documents/classify-batch?sourceId=slideshare&limit=10...");
    const batchRes = await fastify.inject({
      method: "POST",
      url: "/documents/classify-batch?sourceId=slideshare&limit=10",
    });

    console.log(`- Batch Status: ${batchRes.statusCode}`);
    if (batchRes.statusCode !== 200) {
      throw new Error(`Batch classification failed: ${batchRes.body}`);
    }

    const batchJson = JSON.parse(batchRes.body);
    console.log("- Batch Result:", {
      total: batchJson.data.totalProcessed,
      twoPlus: batchJson.data.twoPlusYearsCount,
      lessThanTwo: batchJson.data.lessThanTwoYearsCount,
      needsReview: batchJson.data.needsReviewCount,
    });

    // Verify Doc 2 (1-Year Cert)
    const class2 = await getDocumentClassification(doc2Id);
    console.log("- Doc 2 (1-Year):", { class: class2?.classification, years: class2?.completed_years, reason: class2?.reasoning });
    if (class2?.classification !== "LESS_THAN_TWO_YEARS" || Number(class2?.completed_years) !== 1) {
      throw new Error(`Doc 2 failed: expected LESS_THAN_TWO_YEARS with 1 year, got ${JSON.stringify(class2)}`);
    }

    // Verify Doc 3 (Semester Only)
    const class3 = await getDocumentClassification(doc3Id);
    console.log("- Doc 3 (Semester Only):", { class: class3?.classification, reason: class3?.reasoning });
    if (class3?.classification !== "NEEDS_REVIEW" || class3?.reasoning !== "semester_count_without_year_confirmation") {
      throw new Error(`Doc 3 failed: expected NEEDS_REVIEW with semester_count_without_year_confirmation, got ${JSON.stringify(class3)}`);
    }

    // Verify Doc 4 (Conflicting Dates)
    const class4 = await getDocumentClassification(doc4Id);
    console.log("- Doc 4 (Conflicting):", { class: class4?.classification, reason: class4?.reasoning });
    if (class4?.classification !== "NEEDS_REVIEW" || class4?.reasoning !== "conflicting_evidence") {
      throw new Error(`Doc 4 failed: expected NEEDS_REVIEW with conflicting_evidence, got ${JSON.stringify(class4)}`);
    }

    console.log("✅ [TEST 4 PASSED] Batch classification correctly categorized all test cases.");

    // ============================================================================
    // TEST 5: GET /documents/:id/classification Route
    // ============================================================================
    console.log("\n[TEST 5] Testing GET /documents/:id/classification route...");
    const getRes = await fastify.inject({
      method: "GET",
      url: `/documents/${doc1Id}/classification`,
    });
    if (getRes.statusCode !== 200) {
      throw new Error(`GET classification failed: ${getRes.body}`);
    }
    const getJson = JSON.parse(getRes.body);
    console.log("- Retrieved Classification:", {
      id: getJson.id,
      classification: getJson.classification,
      completed_years: getJson.completed_years,
      duration_text: getJson.duration_text,
      reasoning: getJson.reasoning,
      verification_status: getJson.verification_status,
    });
    if (!getJson.reasoning || !getJson.duration_text) {
      throw new Error("Explainability trail missing: reasoning or duration_text is null!");
    }
    console.log("✅ [TEST 5 PASSED] Full explainability trail verified with duration_text and reasoning.");

    console.log("\n================================================================================");
    console.log("       🎉 ALL PHASE 13 CLASSIFICATION & VERIFICATION TESTS PASSED 100%!         ");
    console.log("================================================================================\n");
  } catch (err: any) {
    console.error("\n❌ [FATAL CLASSIFICATION TEST FAILURE]:", err);
    process.exitCode = 1;
  } finally {
    // Cleanup test fixtures
    console.log("[CLEANUP] Cleaning up test fixtures from Supabase...");
    if (createdDocIds.length > 0) {
      try {
        await query(`DELETE FROM classifications WHERE document_id = ANY($1);`, [createdDocIds]);
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

runClassificationTests();
