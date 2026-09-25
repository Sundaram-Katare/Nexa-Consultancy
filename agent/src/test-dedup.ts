import { buildServer } from "./server";
import { query, closePool } from "./db/pool";
import { deduplicationService } from "./dedup/deduplicationService";
import { normalizeTitle, normalizeInstitution } from "./dedup/normalize";

async function runDedupTests() {
  console.log("================================================================================");
  console.log("             NEXA CONSULTANCY — PHASE 10 DEDUPLICATION TEST SUITE               ");
  console.log("================================================================================\n");

  const fastify = buildServer();
  await fastify.ready();

  const createdDocIds: string[] = [];

  try {
    // 0. Setup: Clean up any old test documents
    console.log("[SETUP] Cleaning up existing test fixtures in Supabase...");
    await query(`DELETE FROM audit_logs WHERE entity_type = 'documents';`);
    await query(`DELETE FROM documents WHERE canonical_url LIKE '%test%' OR canonical_url LIKE '%level3%';`);

    // ============================================================================
    // UNIT TEST: Normalization Helpers
    // ============================================================================
    console.log("\n[TEST 0] Testing normalizeTitle and normalizeInstitution...");
    const rawTitle = "  Official   Academic Transcript: Bachelor of Science (2024)!  ";
    const normTitle = normalizeTitle(rawTitle);
    console.log(`- Title: "${rawTitle}" -> "${normTitle}"`);
    if (normTitle !== "official academic transcript bachelor of science 2024") {
      throw new Error(`Title normalization failed: got "${normTitle}"`);
    }

    const uoftNorm = normalizeInstitution("  U of T  ");
    const uoftFullName = normalizeInstitution("University of Toronto");
    console.log(`- Institution alias: "U of T" -> "${uoftNorm}", "University of Toronto" -> "${uoftFullName}"`);
    if (uoftNorm !== "university of toronto" || uoftFullName !== "university of toronto") {
      throw new Error(`Institution normalization failed for U of T`);
    }
    console.log("✅ [TEST 0 PASSED] Normalization helpers working correctly.");

    // ============================================================================
    // TEST 1: Level 1 Exact Match on (source_id, source_document_id)
    // ============================================================================
    console.log("\n[TEST 1] Testing Level 1 (Exact source_document_id match)...");
    const doc1 = await deduplicationService.checkDuplicateAndIngest({
      sourceId: 2,
      sourceDocId: "test_doc_1001",
      canonicalUrl: "https://slideshare.net/test1001",
      title: "Original Slide Presentation",
      countryId: 1,
    });
    createdDocIds.push(doc1.documentId);
    console.log(`- Inserted Doc 1: ID=${doc1.documentId}, inserted=${doc1.inserted}, duplicate=${doc1.isDuplicate}`);
    if (!doc1.inserted || doc1.isDuplicate) {
      throw new Error("Doc 1 should have been inserted as a new document");
    }

    // Candidate with same source_document_id but different URL
    const doc1Duplicate = await deduplicationService.checkDuplicateAndIngest({
      sourceId: 2,
      sourceDocId: "test_doc_1001",
      canonicalUrl: "https://slideshare.net/test1001_alt_query_path",
      title: "Alternate Title For Same Document",
      countryId: 1,
    });

    console.log(`- Duplicate Check Result:`, doc1Duplicate);
    if (
      doc1Duplicate.inserted !== false ||
      doc1Duplicate.isDuplicate !== true ||
      doc1Duplicate.reason !== "exact_source_id" ||
      doc1Duplicate.confidence !== 1.0 ||
      doc1Duplicate.duplicateOf !== doc1.documentId
    ) {
      throw new Error("Level 1 duplicate failed assertion!");
    }

    // Verify DB count
    const l1Count = await query(
      `SELECT COUNT(*) as count FROM documents WHERE source_id = 2 AND source_document_id = 'test_doc_1001';`
    );
    if (parseInt(l1Count.rows[0].count, 10) !== 1) {
      throw new Error(`Expected exactly 1 row in DB for source_document_id, found ${l1Count.rows[0].count}`);
    }

    // Verify no double inserts across entire table
    const dupCheck = await query(
      `SELECT source_id, source_document_id, count(*) 
       FROM documents 
       WHERE source_document_id IS NOT NULL 
       GROUP BY source_id, source_document_id 
       HAVING count(*) > 1;`
    );
    if (dupCheck.rows.length > 0) {
      throw new Error("Found multiple rows sharing the same source_document_id in DB!");
    }
    console.log("✅ [TEST 1 PASSED] Level 1 exact match prevented double insert.");

    // ============================================================================
    // TEST 2: Level 2 Exact Match on canonical_url (source_document_id null)
    // ============================================================================
    console.log("\n[TEST 2] Testing Level 2 (Exact canonical_url match)...");
    const doc2 = await deduplicationService.checkDuplicateAndIngest({
      sourceId: 2,
      sourceDocId: null,
      canonicalUrl: "https://slideshare.net/test_canonical_unique_2002",
      title: "Document Without Source ID",
      countryId: 1,
    });
    createdDocIds.push(doc2.documentId);
    console.log(`- Inserted Doc 2: ID=${doc2.documentId}, inserted=${doc2.inserted}, duplicate=${doc2.isDuplicate}`);

    const doc2Duplicate = await deduplicationService.checkDuplicateAndIngest({
      sourceId: 2,
      sourceDocId: null,
      canonicalUrl: "https://slideshare.net/test_canonical_unique_2002",
      title: "Another Title At Same Canonical URL",
      countryId: 1,
    });

    console.log(`- Duplicate Check Result:`, doc2Duplicate);
    if (
      doc2Duplicate.inserted !== false ||
      doc2Duplicate.isDuplicate !== true ||
      doc2Duplicate.reason !== "exact_url" ||
      doc2Duplicate.confidence !== 1.0 ||
      doc2Duplicate.duplicateOf !== doc2.documentId
    ) {
      throw new Error("Level 2 duplicate failed assertion!");
    }

    const l2Count = await query(
      `SELECT COUNT(*) as count FROM documents WHERE canonical_url = 'https://slideshare.net/test_canonical_unique_2002';`
    );
    if (parseInt(l2Count.rows[0].count, 10) !== 1) {
      throw new Error(`Expected exactly 1 row in DB for canonical_url, found ${l2Count.rows[0].count}`);
    }
    console.log("✅ [TEST 2 PASSED] Level 2 exact match prevented double insert.");

    // ============================================================================
    // TEST 3: Level 3 Soft Match (Same Normalized Title AND Same Institution)
    // ============================================================================
    console.log("\n[TEST 3] Testing Level 3 (Title + Institution similarity flag)...");
    const doc3A = await deduplicationService.checkDuplicateAndIngest({
      sourceId: 2,
      sourceDocId: "test_level3_a",
      canonicalUrl: "https://slideshare.net/level3_a_doc",
      title: "Official Academic Transcript - 2024",
      institution: "University of Toronto",
      countryId: 1,
    });
    createdDocIds.push(doc3A.documentId);
    console.log(`- Inserted Doc 3A: ID=${doc3A.documentId}, isDuplicate=${doc3A.isDuplicate}`);

    // Doc 3B: Genuinely different source_document_id and URL, but "U of T" and slightly altered punctuation in title
    const doc3B = await deduplicationService.checkDuplicateAndIngest({
      sourceId: 2,
      sourceDocId: "test_level3_b",
      canonicalUrl: "https://slideshare.net/level3_b_doc",
      title: "official academic transcript 2024",
      institution: "U of T",
      countryId: 1,
    });
    createdDocIds.push(doc3B.documentId);
    console.log(`- Inserted Doc 3B (Level 3 Match):`, doc3B);

    if (
      doc3B.inserted !== true ||
      doc3B.isDuplicate !== true ||
      doc3B.reason !== "title_institution_match" ||
      doc3B.confidence !== 0.6 ||
      doc3B.duplicateOf !== doc3A.documentId
    ) {
      throw new Error("Level 3 soft duplicate failed assertion!");
    }

    // Verify BOTH rows exist in the documents table (NOT merged or deleted)
    const bothExistRes = await query(
      `SELECT id, duplicate_of, duplicate_reason, duplicate_confidence 
       FROM documents 
       WHERE id IN ($1, $2)
       ORDER BY created_at ASC;`,
      [doc3A.documentId, doc3B.documentId]
    );

    if (bothExistRes.rows.length !== 2) {
      throw new Error(`Expected BOTH Level 3 documents to exist in table, got count=${bothExistRes.rows.length}`);
    }

    const rowB = bothExistRes.rows.find((r) => r.id === doc3B.documentId);
    if (
      rowB.duplicate_of !== doc3A.documentId ||
      rowB.duplicate_reason !== "title_institution_match" ||
      Number(rowB.duplicate_confidence) !== 0.6
    ) {
      throw new Error(`Doc 3B database row missing expected duplicate metadata: ${JSON.stringify(rowB)}`);
    }

    // Verify audit_logs entry
    const auditRes = await query(
      `SELECT * FROM audit_logs 
       WHERE entity_type = 'documents' 
         AND entity_id = $1 
         AND action = 'FLAG_LEVEL_3_DUPLICATE';`,
      [doc3B.documentId]
    );

    if (auditRes.rows.length === 0) {
      throw new Error("Expected audit_logs entry for Level 3 duplicate flagging!");
    }
    console.log(`- Audit Log verified:`, auditRes.rows[0].details);
    console.log("✅ [TEST 3 PASSED] Level 3 duplicate flagged with confidence 0.6, both rows retained, audit log created.");

    // ============================================================================
    // TEST 4: False Merge Prevention (Same Title, Different Institution)
    // ============================================================================
    console.log("\n[TEST 4] Testing false merge prevention (Same title, DIFFERENT institution)...");
    const doc4 = await deduplicationService.checkDuplicateAndIngest({
      sourceId: 2,
      sourceDocId: "test_level3_diff_inst",
      canonicalUrl: "https://slideshare.net/level3_diff_inst_doc",
      title: "Official Academic Transcript - 2024",
      institution: "McGill University", // Different institution!
      countryId: 1,
    });
    createdDocIds.push(doc4.documentId);
    console.log(`- Inserted Doc 4: ID=${doc4.documentId}, isDuplicate=${doc4.isDuplicate}`);

    if (doc4.isDuplicate !== false || doc4.duplicateOf !== null) {
      throw new Error("Doc 4 was falsely flagged as duplicate despite having a different institution!");
    }

    const doc4Db = await query(
      `SELECT id, duplicate_of FROM documents WHERE id = $1;`,
      [doc4.documentId]
    );
    if (doc4Db.rows[0].duplicate_of !== null) {
      throw new Error("Doc 4 should not have duplicate_of populated in DB!");
    }
    console.log("✅ [TEST 4 PASSED] Different institution correctly prevented false duplicate flag.");

    // ============================================================================
    // TEST 5: API Route GET /documents/duplicates?confidence=0.6
    // ============================================================================
    console.log("\n[TEST 5] Testing GET /documents/duplicates?confidence=0.6 API route...");
    const apiRes = await fastify.inject({
      method: "GET",
      url: "/documents/duplicates?confidence=0.6",
    });

    console.log(`- Response status: ${apiRes.statusCode}`);
    if (apiRes.statusCode !== 200) {
      throw new Error(`API route failed: ${apiRes.body}`);
    }

    const apiJson = JSON.parse(apiRes.body);
    console.log(`- Returned duplicates count: ${apiJson.count}`);
    console.log(`- Duplicates payload:`, JSON.stringify(apiJson.duplicates, null, 2));

    const foundFlaggedPair = apiJson.duplicates.find(
      (d: any) => d.id === doc3B.documentId && d.duplicateOf === doc3A.documentId
    );

    if (!foundFlaggedPair) {
      throw new Error("API route did not return the expected Level-3 flagged duplicate pair!");
    }

    // Verify Level-1 and Level-2 documents are NOT in duplicates endpoint
    const containsL1 = apiJson.duplicates.some((d: any) => d.id === doc1.documentId);
    const containsL2 = apiJson.duplicates.some((d: any) => d.id === doc2.documentId);
    if (containsL1 || containsL2) {
      throw new Error("Level-1 or Level-2 documents erroneously appeared in /documents/duplicates endpoint!");
    }

    console.log("✅ [TEST 5 PASSED] GET /documents/duplicates correctly returned Level-3 flagged pairs with original details.");

    console.log("\n================================================================================");
    console.log("            🎉 ALL PHASE 10 DEDUPLICATION TESTS PASSED 100%!                    ");
    console.log("================================================================================\n");
  } catch (err: any) {
    console.error("\n❌ [FATAL DEDUP TEST FAILURE]:", err);
    process.exitCode = 1;
  } finally {
    // Cleanup test documents
    console.log("[CLEANUP] Cleaning up test documents...");
    if (createdDocIds.length > 0) {
      try {
        await query(`DELETE FROM classifications WHERE document_id = ANY($1);`, [createdDocIds]);
        await query(`DELETE FROM evidence_signals WHERE document_id = ANY($1);`, [createdDocIds]);
        await query(`DELETE FROM document_evidence WHERE document_id = ANY($1);`, [createdDocIds]);
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

runDedupTests();
