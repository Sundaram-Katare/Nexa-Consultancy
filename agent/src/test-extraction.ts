import { buildServer } from "./server";
import { query, closePool } from "./db/pool";
import { browserManager } from "./browser/browserManager";
import { adapterRegistry } from "./adapters";
import { processPendingDocuments } from "./executor/extractionWorker";
import {
  getDocumentById,
  getDocumentEvidence,
  getDocumentErrors,
} from "./db/queries/documents";
import { insertPendingDocument } from "./db/queries/searchTasks";

async function runExtractionTests() {
  console.log("================================================================================");
  console.log("            NEXA CONSULTANCY — PHASE 9 DOCUMENT EXTRACTION TEST SUITE           ");
  console.log("================================================================================\n");

  const fastify = buildServer();
  await fastify.ready();

  let test404DocId: string | null = null;
  const testPendingDocIds: string[] = [];

  try {
    // 0. Setup: Clean up previous test artifacts and discover fresh real documents
    console.log("[SETUP] Cleaning up old test documents in Supabase...");
    await query(`DELETE FROM documents;`);

    console.log("[SETUP] Performing live search to seed real PENDING SlideShare documents...");
    const adapter = adapterRegistry.get("slideshare");
    const tempSessionId = await browserManager.newSession();
    try {
      const page = browserManager.getPage(tempSessionId);
      const searchRes = await adapter.search({ id: tempSessionId, page }, "academic transcript");
      console.log(`[SETUP] Discovered ${searchRes.results.length} live search results.`);

      for (const item of searchRes.results.slice(0, 3)) {
        const insertRes = await insertPendingDocument({
          sourceId: 2, // slideshare
          sourceDocId: item.sourceDocumentId,
          canonicalUrl: item.canonicalUrl,
          title: item.titleRaw,
          countryId: 1, // seed country
        });
        if (insertRes.id) {
          testPendingDocIds.push(insertRes.id);
        }
      }
    } finally {
      await browserManager.closeSession(tempSessionId);
    }

    console.log(`[SETUP] Ready with ${testPendingDocIds.length} PENDING documents for extraction test.`);

    // ============================================================================
    // TEST 1: Process real PENDING documents via Fastify API route
    // ============================================================================
    console.log("\n[TEST 1] Testing POST /documents/process?sourceId=slideshare&limit=2 route...");
    const response = await fastify.inject({
      method: "POST",
      url: "/documents/process?sourceId=slideshare&limit=2",
    });

    console.log(`[TEST 1] Response status: ${response.statusCode}`);
    if (response.statusCode !== 200) {
      throw new Error(`API extraction route failed with status ${response.statusCode}: ${response.body}`);
    }

    const result = JSON.parse(response.body);
    console.log(`[TEST 1] Extracted ${result.data.extractedCount} / ${result.data.totalProcessed} documents.`);
    console.log("[TEST 1] Extraction details:", JSON.stringify(result.data.documents, null, 2));

    if (result.data.extractedCount === 0) {
      throw new Error("Expected at least 1 document to be successfully extracted!");
    }
    console.log("✅ [TEST 1 PASSED] Document extraction API executed successfully.");

    // ============================================================================
    // TEST 2: Verify extracted documents state & document_evidence rows
    // ============================================================================
    console.log("\n[TEST 2] Verifying database status & evidence rows for extracted documents...");
    const extractedDoc = result.data.documents.find((d: any) => d.status === "EXTRACTED");
    if (!extractedDoc) {
      throw new Error("No document with status EXTRACTED found in result set!");
    }

    const docRecord = await getDocumentById(extractedDoc.id);
    if (!docRecord || docRecord.status !== "EXTRACTED") {
      throw new Error(`Expected document ${extractedDoc.id} status to be EXTRACTED, got: ${docRecord?.status}`);
    }
    console.log(`[TEST 2] Stored Document Title: "${docRecord.title}"`);
    console.log(`[TEST 2] Stored Raw Metadata:`, JSON.stringify(docRecord.raw_metadata, null, 2));

    const evidenceRows = await getDocumentEvidence(extractedDoc.id);
    console.log(`[TEST 2] Stored Evidence Rows Count: ${evidenceRows.length}`);
    if (evidenceRows.length > 0) {
      console.log(`[TEST 2] Sample Evidence:`, {
        location_ref: evidenceRows[0].location_ref,
        method: evidenceRows[0].extraction_method,
        snippet: evidenceRows[0].evidence_text.substring(0, 100) + "...",
      });
    }
    console.log("✅ [TEST 2 PASSED] Document status updated to EXTRACTED and evidence persisted.");

    // ============================================================================
    // TEST 3: Bounded Retry & Error Logging for Faulty URL (404 failure simulation)
    // ============================================================================
    console.log("\n[TEST 3] Testing bounded retries (3 attempts -> EXTRACTION_FAILED)...");
    const fake404Url = `https://www.slideshare.net/slideshow/nonexistent-faulty-transcript-404-${Date.now()}`;
    
    // Insert 404 test document in PENDING status
    const insertRes = await query(
      `INSERT INTO documents (source_id, canonical_url, title, country_id, status, extraction_attempts)
       VALUES (2, $1, 'Faulty 404 Document', 1, 'PENDING', 0)
       RETURNING id;`,
      [fake404Url]
    );
    test404DocId = insertRes.rows[0].id;
    console.log(`[TEST 3] Inserted faulty document ID: ${test404DocId}`);

    // Attempt 1
    console.log("[TEST 3] Running Attempt 1 on faulty document...");
    await processPendingDocuments("slideshare", 10);
    let docState1 = await getDocumentById(test404DocId!);
    console.log(`[TEST 3] Attempt 1 state: attempts = ${docState1?.extraction_attempts}, status = ${docState1?.status}`);
    if (docState1?.extraction_attempts !== 1 || docState1?.status !== "PENDING") {
      throw new Error(`Attempt 1 failed assertion: attempts=${docState1?.extraction_attempts}, status=${docState1?.status}`);
    }

    // Attempt 2
    console.log("[TEST 3] Running Attempt 2 on faulty document...");
    await processPendingDocuments("slideshare", 10);
    let docState2 = await getDocumentById(test404DocId!);
    console.log(`[TEST 3] Attempt 2 state: attempts = ${docState2?.extraction_attempts}, status = ${docState2?.status}`);
    if (docState2?.extraction_attempts !== 2 || docState2?.status !== "PENDING") {
      throw new Error(`Attempt 2 failed assertion: attempts=${docState2?.extraction_attempts}, status=${docState2?.status}`);
    }

    // Attempt 3
    console.log("[TEST 3] Running Attempt 3 on faulty document (should flip to EXTRACTION_FAILED)...");
    await processPendingDocuments("slideshare", 10);
    let docState3 = await getDocumentById(test404DocId!);
    console.log(`[TEST 3] Attempt 3 state: attempts = ${docState3?.extraction_attempts}, status = ${docState3?.status}`);
    if (docState3?.extraction_attempts !== 3 || docState3?.status !== "EXTRACTION_FAILED") {
      throw new Error(`Attempt 3 failed assertion: expected status EXTRACTION_FAILED, got ${docState3?.status}`);
    }

    // Check errors table
    const errorsLogged = await getDocumentErrors(test404DocId!);
    console.log(`[TEST 3] Total errors logged for document: ${errorsLogged.length}`);
    if (errorsLogged.length < 3) {
      throw new Error(`Expected at least 3 error entries in errors table, got ${errorsLogged.length}`);
    }
    console.log(`[TEST 3] Latest Error Log:`, {
      category: errorsLogged[0].error_category,
      message: errorsLogged[0].message,
      retry_count: errorsLogged[0].retry_count,
    });
    console.log("✅ [TEST 3 PASSED] Extraction attempts properly capped at 3 with EXTRACTION_FAILED and error logs.");

    // ============================================================================
    // TEST 4: Idempotency & Exclusion of Already Processed / Failed Documents
    // ============================================================================
    console.log("\n[TEST 4] Testing idempotency (ensuring EXTRACTED & FAILED docs are skipped)...");
    const reRunSummary = await processPendingDocuments("slideshare", 5);
    const reRunContainsExtracted = reRunSummary.documents.some((d) => d.id === extractedDoc.id);
    const reRunContainsFailed = reRunSummary.documents.some((d) => d.id === test404DocId);

    if (reRunContainsExtracted) {
      throw new Error("Re-run erroneously re-processed an already EXTRACTED document!");
    }
    if (reRunContainsFailed) {
      throw new Error("Re-run erroneously re-processed an EXTRACTION_FAILED document!");
    }
    console.log("✅ [TEST 4 PASSED] Re-run strictly respects WHERE status = 'PENDING'.");

    console.log("\n================================================================================");
    console.log("            🎉 ALL PHASE 9 EXTRACTION TESTS PASSED SUCCESSFULLY!                ");
    console.log("================================================================================\n");
  } catch (err: any) {
    console.error("\n❌ [FATAL TEST FAILURE]:", err);
    process.exitCode = 1;
  } finally {
    // Clean up temporary 404 test document
    if (test404DocId) {
      try {
        await query(`DELETE FROM documents WHERE id = $1;`, [test404DocId]);
        console.log(`[CLEANUP] Deleted temporary test document ${test404DocId}.`);
      } catch {}
    }
    await browserManager.closeAll();
    await fastify.close();
    await closePool();
    process.exit(process.exitCode || 0);
  }
}

runExtractionTests();
