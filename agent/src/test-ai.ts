import { z } from "zod";
import { query } from "./db/pool";
import { OllamaClient } from "./ai/ollamaClient";
import {
  RelevanceResponseSchema,
  ClassificationResponseSchema,
  AiUnavailableError,
  AiInvalidResponseError,
} from "./ai/schemas";
import { runRelevanceFilter } from "./relevance/relevanceFilter";
import { classify } from "./classification/classificationEngine";

async function runAiTests() {
  console.log("================================================================================");
  console.log("🧪 PHASE 20 — Local AI (Ollama Integration) Test Suite");
  console.log("================================================================================\n");

  // Step 1: Test Schema Validation & Error Types
  console.log("--------------------------------------------------------------------------------");
  console.log("Step 1: Testing AI Zod Schemas & Validation Logic");
  console.log("--------------------------------------------------------------------------------");

  // Valid Relevance
  const validRel = RelevanceResponseSchema.safeParse({
    relevant: true,
    confidence: 0.95,
    reasoning: "Contains clear cumulative GPA table and university semester courses.",
  });
  if (!validRel.success) throw new Error("RelevanceResponseSchema failed on valid data");
  console.log("✅ RelevanceResponseSchema validated conformant payload.");

  // Invalid Relevance (negative confidence)
  const invalidRel = RelevanceResponseSchema.safeParse({
    relevant: true,
    confidence: -0.5,
    reasoning: "test",
  });
  if (invalidRel.success) throw new Error("RelevanceResponseSchema accepted invalid confidence!");
  console.log("✅ RelevanceResponseSchema rejected non-conformant payload.");

  // Valid Classification
  const validClass = ClassificationResponseSchema.safeParse({
    classification: "TWO_PLUS_YEARS",
    completedYears: 3.0,
    reasoning: "Dates span from September 2019 to June 2022 with final degree awarded.",
    confidence: 0.92,
  });
  if (!validClass.success) throw new Error("ClassificationResponseSchema failed on valid data");
  console.log("✅ ClassificationResponseSchema validated conformant payload.");

  // Step 2: Test Ollama Client Resilience (Unreachable URL / Fallback)
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 2: Testing OllamaClient Unreachable Fallback (AI_UNAVAILABLE)");
  console.log("--------------------------------------------------------------------------------");

  const unreachableClient = new OllamaClient({
    baseUrl: "http://127.0.0.1:59999", // non-existent port
    timeoutMs: 1500,
  });

  const isAvailable = await unreachableClient.isAvailable();
  console.log(`[Unreachable Server Check] isAvailable: ${isAvailable} (Expected: false)`);
  if (isAvailable) throw new Error("Unreachable client should report isAvailable = false");

  let threwUnavailable = false;
  try {
    await unreachableClient.generate("Test prompt", RelevanceResponseSchema);
  } catch (err: any) {
    if (err instanceof AiUnavailableError) {
      threwUnavailable = true;
      console.log(`✅ Correctly caught AiUnavailableError: ${err.message}`);
    }
  }

  if (!threwUnavailable) {
    throw new Error("❌ OllamaClient did not throw AiUnavailableError on unreachable server!");
  }

  // Step 3: Test End-to-End Fallback in Relevance Filter
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 3: Testing Relevance Filter Graceful Fallback on AMBIGUOUS Case");
  console.log("--------------------------------------------------------------------------------");

  // Create an ambiguous test document
  const testDocRes = await query<{ id: string }>(
    `INSERT INTO documents (
       source_id, canonical_url, title, status
     ) VALUES (
       (SELECT id FROM sources LIMIT 1),
       'https://www.slideshare.net/test-ambiguous-ai-' || gen_random_uuid(),
       'Department Academic Overview and Student Progress Report',
       'EXTRACTED'
     ) RETURNING id;`
  );
  const ambiguousDocId = testDocRes.rows[0].id;

  // Insert ambiguous evidence text (no clear transcript / mark sheet keywords)
  await query(
    `INSERT INTO document_evidence (
       document_id, evidence_text, extraction_method
     ) VALUES ($1, 'Annual student evaluation overview and departmental milestones.', 'test');`,
    [ambiguousDocId]
  );

  // Run relevance filter - should catch AMBIGUOUS and attempt AI, then gracefully fall back if Ollama down
  const filterSummary = await runRelevanceFilter(undefined, 50);
  const evaluatedDoc = filterSummary.results.find((r) => r.id === ambiguousDocId);

  if (!evaluatedDoc) {
    throw new Error(`❌ Test ambiguous doc ${ambiguousDocId} was not processed by relevance filter`);
  }

  console.log(`✅ Ambiguous Document Outcome: Status=${evaluatedDoc.status}, Verdict=${evaluatedDoc.verdict}`);
  if (evaluatedDoc.status !== "NEEDS_RELEVANCE_REVIEW" && evaluatedDoc.status !== "CLASSIFIED_PENDING" && evaluatedDoc.status !== "IRRELEVANT") {
    throw new Error(`❌ Unexpected document status for ambiguous case: ${evaluatedDoc.status}`);
  }

  // Step 4: Strict Boundary Verification for Classification Engine
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 4: Verifying Strict Anti-Hallucination Boundaries in Classification");
  console.log("--------------------------------------------------------------------------------");

  // 4.1 Case 1: Zero evidence signals -> MUST resolve to NEEDS_REVIEW / RULE_BASED (Never invoke LLM)
  const zeroEvidenceDocRes = await query<{ id: string }>(
    `INSERT INTO documents (
       source_id, canonical_url, title, status
     ) VALUES (
       (SELECT id FROM sources LIMIT 1),
       'https://www.slideshare.net/test-zero-evidence-' || gen_random_uuid(),
       'Bachelor of Science Syllabus Document',
       'CLASSIFIED_PENDING'
     ) RETURNING id;`
  );
  const zeroDocId = zeroEvidenceDocRes.rows[0].id;

  const zeroClassification = await classify(zeroDocId);
  console.log(`[Zero Evidence Case] Classification: ${zeroClassification.classification}, VerificationStatus: ${zeroClassification.verification_status}, Reason: ${zeroClassification.reasoning}`);
  if (zeroClassification.classification !== "NEEDS_REVIEW" || zeroClassification.verification_status !== "RULE_BASED") {
    throw new Error("❌ Zero evidence document must be classified as NEEDS_REVIEW with RULE_BASED verification!");
  }
  console.log("✅ Zero evidence case strictly kept as RULE_BASED without invoking LLM.");

  // 4.2 Case 2: Conflicting evidence signals -> MUST resolve to NEEDS_REVIEW / RULE_BASED (Never invoke LLM)
  const conflictDocRes = await query<{ id: string }>(
    `INSERT INTO documents (
       source_id, canonical_url, title, status
     ) VALUES (
       (SELECT id FROM sources LIMIT 1),
       'https://www.slideshare.net/test-conflict-evidence-' || gen_random_uuid(),
       'Academic Transcript of Conflicting Dates',
       'CLASSIFIED_PENDING'
     ) RETURNING id;`
  );
  const conflictDocId = conflictDocRes.rows[0].id;

  // Insert two conflicting date ranges: 2018-2019 (1 yr) vs 2018-2022 (4 yrs)
  await query(
    `INSERT INTO evidence_signals (document_id, signal_type, raw_text, extracted_value)
     VALUES ($1, 'DATE_RANGE', 'Attended: 2018 - 2019', '2018 - 2019'),
            ($1, 'DATE_RANGE', 'Dates: 2018 - 2022', '2018 - 2022');`,
    [conflictDocId]
  );

  const conflictClassification = await classify(conflictDocId);
  console.log(`[Conflicting Case] Classification: ${conflictClassification.classification}, VerificationStatus: ${conflictClassification.verification_status}, Reason: ${conflictClassification.reasoning}`);
  if (conflictClassification.classification !== "NEEDS_REVIEW" || conflictClassification.verification_status !== "RULE_BASED") {
    throw new Error("❌ Conflicting evidence document must be classified as NEEDS_REVIEW with RULE_BASED verification!");
  }
  console.log("✅ Conflicting evidence case strictly kept as RULE_BASED without invoking LLM.");

  // 4.3 Case 3: Ambiguous phrasing signal -> Eligible for AI resolution / graceful fallback
  const ambiguousSignalDocRes = await query<{ id: string }>(
    `INSERT INTO documents (
       source_id, canonical_url, title, status
     ) VALUES (
       (SELECT id FROM sources LIMIT 1),
       'https://www.slideshare.net/test-ambiguous-signal-' || gen_random_uuid(),
       'Academic Transcript with Complex Date Text',
       'CLASSIFIED_PENDING'
     ) RETURNING id;`
  );
  const ambSigDocId = ambiguousSignalDocRes.rows[0].id;

  await query(
    `INSERT INTO evidence_signals (document_id, signal_type, raw_text, extracted_value)
     VALUES ($1, 'SEMESTER_COUNT', 'Completed semesters I through VI across consecutive academic sessions', 'semesters I through VI');`,
    [ambSigDocId]
  );

  const ambClassification = await classify(ambSigDocId);
  console.log(`[Ambiguous Phrasing Case] Classification: ${ambClassification.classification}, VerificationStatus: ${ambClassification.verification_status}, Reason: ${ambClassification.reasoning}`);
  if (!["TWO_PLUS_YEARS", "LESS_THAN_TWO_YEARS", "NEEDS_REVIEW"].includes(ambClassification.classification)) {
    throw new Error("❌ Invalid classification returned for ambiguous signal document");
  }
  console.log("✅ Ambiguous phrasing case handled with valid schema-conformant result.");

  // Cleanup test documents and dependent rows
  await query(`DELETE FROM classifications WHERE document_id IN ($1, $2, $3, $4);`, [
    ambiguousDocId,
    zeroDocId,
    conflictDocId,
    ambSigDocId,
  ]);
  await query(`DELETE FROM evidence_signals WHERE document_id IN ($1, $2, $3, $4);`, [
    ambiguousDocId,
    zeroDocId,
    conflictDocId,
    ambSigDocId,
  ]);
  await query(`DELETE FROM document_evidence WHERE document_id IN ($1, $2, $3, $4);`, [
    ambiguousDocId,
    zeroDocId,
    conflictDocId,
    ambSigDocId,
  ]);
  await query(`DELETE FROM documents WHERE id IN ($1, $2, $3, $4);`, [
    ambiguousDocId,
    zeroDocId,
    conflictDocId,
    ambSigDocId,
  ]);

  console.log("\n================================================================================");
  console.log("🎉 ALL PHASE 20 LOCAL AI / OLLAMA INTEGRATION TESTS PASSED!");
  console.log("================================================================================\n");

  process.exit(0);
}

runAiTests().catch((err) => {
  console.error("❌ AI Test Failed:", err);
  process.exit(1);
});
