import { buildServer } from "./server";
import { query, closePool } from "./db/pool";
import { deterministicRelevanceCheck } from "./relevance/keywordFilter";
import { classifyRelevance } from "./relevance/llmClient";
import { insertDocumentEvidence } from "./db/queries/documents";

async function runRelevanceTests() {
  console.log("================================================================================");
  console.log("       NEXA CONSULTANCY — PHASE 11 TRANSCRIPT RELEVANCE FILTER TEST SUITE       ");
  console.log("================================================================================\n");

  const fastify = buildServer();
  await fastify.ready();

  const createdDocIds: string[] = [];

  try {
    // ============================================================================
    // TEST 1: Unit Tests on Deterministic Keyword Rules
    // ============================================================================
    console.log("[TEST 1] Testing deterministic keyword filter unit rules...");

    // Case 1A: Clear Genuine Transcript -> RELEVANT
    const check1A = deterministicRelevanceCheck(
      "Official Academic Transcript - University of Alberta",
      ["Office of the Registrar", "Credit hours: 64", "Cumulative GPA: 3.75", "Bachelor of Science"]
    );
    console.log(`- 1A (Clear Transcript): verdict=${check1A.verdict}, conf=${check1A.confidence}`);
    if (check1A.verdict !== "RELEVANT") {
      throw new Error(`Expected RELEVANT for 1A, got ${check1A.verdict} (${check1A.reason})`);
    }

    // Case 1B: Clear Irrelevant Content -> NOT_RELEVANT
    const check1B = deterministicRelevanceCheck(
      "Digital Marketing & SEO Growth Strategy 2024",
      ["Customer acquisition cost", "Conversion funnel", "Quarterly ROI revenue metrics"]
    );
    console.log(`- 1B (Marketing Deck): verdict=${check1B.verdict}, conf=${check1B.confidence}`);
    if (check1B.verdict !== "NOT_RELEVANT") {
      throw new Error(`Expected NOT_RELEVANT for 1B, got ${check1B.verdict} (${check1B.reason})`);
    }

    // Case 1C: Transcript keyword with Exclusion/Template terms -> AMBIGUOUS
    const check1C = deterministicRelevanceCheck(
      "College Transcript Request Form Template",
      ["Sample template for official request", "Credit hours: 30", "Grade point average: 3.5", "Office of the registrar"]
    );
    console.log(`- 1C (Template with Academic Signal): verdict=${check1C.verdict}, conf=${check1C.confidence}`);
    if (check1C.verdict !== "AMBIGUOUS") {
      throw new Error(`Expected AMBIGUOUS for 1C, got ${check1C.verdict} (${check1C.reason})`);
    }

    // Case 1D: Generic Presentation without transcript keyword -> NOT_RELEVANT
    const check1D = deterministicRelevanceCheck(
      "Introduction to Python Programming Syllabus",
      ["Week 1: Variables", "Week 2: Loops", "Assignment guidelines"]
    );
    console.log(`- 1D (Syllabus): verdict=${check1D.verdict}, conf=${check1D.confidence}`);
    if (check1D.verdict !== "NOT_RELEVANT") {
      throw new Error(`Expected NOT_RELEVANT for 1D, got ${check1D.verdict}`);
    }

    console.log("✅ [TEST 1 PASSED] Deterministic keyword filter correctly categorized all rule cases.");

    // ============================================================================
    // TEST 2: LLM Client Stub Safety Check
    // ============================================================================
    console.log("\n[TEST 2] Testing stubbed LLM client safety guard (Phase 20)...");
    let threwNotImplemented = false;
    try {
      await classifyRelevance("Some Title", ["Some Evidence"]);
    } catch (err: any) {
      if (err.message.includes("NOT_IMPLEMENTED")) {
        threwNotImplemented = true;
        console.log(`- Caught expected guard error: "${err.message}"`);
      }
    }
    if (!threwNotImplemented) {
      throw new Error("Expected classifyRelevance to throw NOT_IMPLEMENTED error in Phase 11!");
    }
    console.log("✅ [TEST 2 PASSED] LLM client is safely stubbed with explicit Phase 20 notice.");

    // ============================================================================
    // TEST 3: Database & Route Integration Test on EXTRACTED documents
    // ============================================================================
    console.log("\n[TEST 3] Testing POST /documents/relevance-filter pipeline on EXTRACTED documents...");

    // Setup 3 test documents in EXTRACTED status
    // Doc A: Genuine Transcript -> Expected CLASSIFIED_PENDING
    const resA = await query(
      `INSERT INTO documents (source_id, canonical_url, title, country_id, status)
       VALUES (2, 'https://slideshare.net/test_relevance_real_transcript', 'Official Academic Transcript', 1, 'EXTRACTED')
       RETURNING id;`
    );
    const docAId = resA.rows[0].id;
    createdDocIds.push(docAId);
    await insertDocumentEvidence(docAId, [
      "University of British Columbia - Faculty of Science",
      "Cumulative GPA: 3.82, Total Credits Earned: 120",
      "Office of the Registrar, Conferred: Bachelor of Science",
    ]);

    // Doc B: Irrelevant Business Deck -> Expected IRRELEVANT
    const resB = await query(
      `INSERT INTO documents (source_id, canonical_url, title, country_id, status)
       VALUES (2, 'https://slideshare.net/test_relevance_irrelevant_deck', 'B2B SaaS Sales Presentation Deck', 1, 'EXTRACTED')
       RETURNING id;`
    );
    const docBId = resB.rows[0].id;
    createdDocIds.push(docBId);
    await insertDocumentEvidence(docBId, [
      "Monthly Recurring Revenue MRR Growth",
      "Customer Churn Rate Analysis",
      "Sales Pipeline Conversion Funnel",
    ]);

    // Doc C: Ambiguous Template with partial signal -> Expected NEEDS_RELEVANCE_REVIEW
    const resC = await query(
      `INSERT INTO documents (source_id, canonical_url, title, country_id, status)
       VALUES (2, 'https://slideshare.net/test_relevance_ambiguous_template', 'Official Transcript Request Guidelines & Template', 1, 'EXTRACTED')
       RETURNING id;`
    );
    const docCId = resC.rows[0].id;
    createdDocIds.push(docCId);
    await insertDocumentEvidence(docCId, [
      "Guidelines for transcript request application procedure",
      "Grade point average calculation sample: GPA 3.6",
      "Credit hours requirements and office of the registrar instructions",
    ]);

    console.log(`- Seeded 3 EXTRACTED test documents: Real=${docAId}, Irrelevant=${docBId}, Ambiguous=${docCId}`);

    // Call POST /documents/relevance-filter?sourceId=slideshare&limit=10
    const filterRes = await fastify.inject({
      method: "POST",
      url: "/documents/relevance-filter?sourceId=slideshare&limit=10",
    });

    console.log(`- API Response status: ${filterRes.statusCode}`);
    if (filterRes.statusCode !== 200) {
      throw new Error(`Relevance filter API failed: ${filterRes.body}`);
    }

    const filterJson = JSON.parse(filterRes.body);
    console.log("- Filter Summary:", {
      total: filterJson.data.totalProcessed,
      relevant: filterJson.data.relevantCount,
      irrelevant: filterJson.data.irrelevantCount,
      ambiguous: filterJson.data.ambiguousCount,
    });

    // Verify Doc A status in DB
    const dbDocA = (await query(`SELECT status, raw_metadata FROM documents WHERE id = $1;`, [docAId])).rows[0];
    console.log(`- Doc A (Real) DB status: ${dbDocA.status}, Reason: ${dbDocA.raw_metadata?.relevance?.reason}`);
    if (dbDocA.status !== "CLASSIFIED_PENDING") {
      throw new Error(`Expected Doc A status to be CLASSIFIED_PENDING, got ${dbDocA.status}`);
    }

    // Verify Doc B status in DB
    const dbDocB = (await query(`SELECT status, raw_metadata FROM documents WHERE id = $1;`, [docBId])).rows[0];
    console.log(`- Doc B (Irrelevant) DB status: ${dbDocB.status}, Reason: ${dbDocB.raw_metadata?.relevance?.reason}`);
    if (dbDocB.status !== "IRRELEVANT") {
      throw new Error(`Expected Doc B status to be IRRELEVANT, got ${dbDocB.status}`);
    }

    // Verify Doc C status in DB
    const dbDocC = (await query(`SELECT status, raw_metadata FROM documents WHERE id = $1;`, [docCId])).rows[0];
    console.log(`- Doc C (Ambiguous) DB status: ${dbDocC.status}, Reason: ${dbDocC.raw_metadata?.relevance?.reason}`);
    if (dbDocC.status !== "NEEDS_RELEVANCE_REVIEW") {
      throw new Error(`Expected Doc C status to be NEEDS_RELEVANCE_REVIEW, got ${dbDocC.status}`);
    }

    console.log("✅ [TEST 3 PASSED] Filter correctly moved documents to CLASSIFIED_PENDING, IRRELEVANT, and NEEDS_RELEVANCE_REVIEW.");

    // ============================================================================
    // TEST 4: Inspection of NEEDS_RELEVANCE_REVIEW Queue
    // ============================================================================
    console.log("\n[TEST 4] Testing GET /documents/needs-relevance-review...");
    const reviewRes = await fastify.inject({
      method: "GET",
      url: "/documents/needs-relevance-review",
    });

    console.log(`- Review queue status: ${reviewRes.statusCode}`);
    if (reviewRes.statusCode !== 200) {
      throw new Error(`Review queue API failed: ${reviewRes.body}`);
    }

    const reviewJson = JSON.parse(reviewRes.body);
    console.log(`- Review queue total count: ${reviewJson.count}`);
    const foundDocC = reviewJson.queue.find((d: any) => d.id === docCId);
    if (!foundDocC) {
      throw new Error("Doc C was not found in the NEEDS_RELEVANCE_REVIEW queue!");
    }
    console.log("- Review Queue Item sample:", {
      id: foundDocC.id,
      title: foundDocC.title,
      relevanceDetails: foundDocC.relevance_details,
    });
    console.log("✅ [TEST 4 PASSED] GET /documents/needs-relevance-review returned the ambiguous documents queue.");

    // ============================================================================
    // TEST 5: Idempotency (Non-EXTRACTED docs untouched on re-run)
    // ============================================================================
    console.log("\n[TEST 5] Testing idempotency on re-run (skipping processed docs)...");
    const reRunRes = await fastify.inject({
      method: "POST",
      url: "/documents/relevance-filter?sourceId=slideshare&limit=10",
    });

    const reRunJson = JSON.parse(reRunRes.body);
    console.log(`- Re-run totalProcessed count: ${reRunJson.data.totalProcessed}`);
    const reProcessedDocA = reRunJson.data.results.some((r: any) => r.id === docAId);
    if (reProcessedDocA) {
      throw new Error("Re-run erroneously re-processed an already filtered document!");
    }
    console.log("✅ [TEST 5 PASSED] Re-run strictly respects WHERE status = 'EXTRACTED'.");

    console.log("\n================================================================================");
    console.log("      🎉 ALL PHASE 11 TRANSCRIPT RELEVANCE FILTER TESTS PASSED 100%!            ");
    console.log("================================================================================\n");
  } catch (err: any) {
    console.error("\n❌ [FATAL RELEVANCE TEST FAILURE]:", err);
    process.exitCode = 1;
  } finally {
    // Cleanup test documents
    console.log("[CLEANUP] Cleaning up test documents from Supabase...");
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

runRelevanceTests();
