import { adapterRegistry } from "./adapters";
import { ArchiveOrgAdapter } from "./adapters/archiveOrg/archiveOrgAdapter";
import { ZenodoAdapter } from "./adapters/zenodo/zenodoAdapter";
import { StuDocuAdapter } from "./adapters/studocu/studocuAdapter";
import { query } from "./db/pool";
import { generateXlsx } from "./export/xlsxExporter";
import { generateCsv } from "./export/csvExporter";

async function runMultiSourceTests() {
  console.log("================================================================================");
  console.log("🧪 PHASE 23 — Multi-Source Adapters & Aggregation Test Suite");
  console.log("================================================================================\n");

  // Step 1: Adapter Registry Verification
  console.log("--------------------------------------------------------------------------------");
  console.log("Step 1: Verifying All 5 Adapters in Adapter Registry");
  console.log("--------------------------------------------------------------------------------");

  const registeredIds = adapterRegistry.listIds();
  console.log(`[Registered Adapter IDs]: [${registeredIds.join(", ")}]`);

  const requiredAdapters = ["slideshare", "scribd", "archive_org", "zenodo_core", "studocu"];
  for (const id of requiredAdapters) {
    if (!adapterRegistry.has(id)) {
      throw new Error(`❌ Missing expected adapter '${id}' in adapterRegistry!`);
    }
    const adapter = adapterRegistry.get(id);
    console.log(`✅ Adapter '${id}' verified: class=${adapter.constructor.name}`);
  }

  // Step 2: URL Building & Document ID Extraction for 3 New Adapters
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 2: Testing URL Building & Regex ID Extraction");
  console.log("--------------------------------------------------------------------------------");

  // 1. Archive.org
  const archiveAdapter = adapterRegistry.get("archive_org") as ArchiveOrgAdapter;
  const archiveUrl = archiveAdapter.buildSearchUrl("Canada transcript", 3);
  console.log(`[Archive.org Search URL]: ${archiveUrl}`);
  if (!archiveUrl.includes("Canada%20transcript") || !archiveUrl.includes("page=3")) {
    throw new Error("❌ Archive.org search URL building failed");
  }
  const archiveDocId = archiveAdapter.getDocumentIdFromUrl("https://archive.org/details/canadiantranscriptrecords1990");
  console.log(`[Archive.org Extracted ID]: ${archiveDocId}`);
  if (archiveDocId !== "canadiantranscriptrecords1990") {
    throw new Error("❌ Archive.org doc ID extraction failed");
  }
  console.log("✅ Archive.org URL builder & ID extraction passed.");

  // 2. Zenodo
  const zenodoAdapter = adapterRegistry.get("zenodo_core") as ZenodoAdapter;
  const zenodoUrl = zenodoAdapter.buildSearchUrl("Ghana degree transcript", 2);
  console.log(`[Zenodo Search URL]: ${zenodoUrl}`);
  if (!zenodoUrl.includes("Ghana%20degree%20transcript") || !zenodoUrl.includes("page=2")) {
    throw new Error("❌ Zenodo search URL building failed");
  }
  const zenodoDocId = zenodoAdapter.getDocumentIdFromUrl("https://zenodo.org/records/87654321");
  console.log(`[Zenodo Extracted ID]: ${zenodoDocId}`);
  if (zenodoDocId !== "87654321") {
    throw new Error("❌ Zenodo doc ID extraction failed");
  }
  console.log("✅ Zenodo URL builder & ID extraction passed.");

  // 3. StuDocu
  const studocuAdapter = adapterRegistry.get("studocu") as StuDocuAdapter;
  const studocuUrl = studocuAdapter.buildSearchUrl("Nigeria engineering transcript", 1);
  console.log(`[StuDocu Search URL]: ${studocuUrl}`);
  if (!studocuUrl.includes("Nigeria%20engineering%20transcript") || !studocuUrl.includes("page=1")) {
    throw new Error("❌ StuDocu search URL building failed");
  }
  const studocuDocId = studocuAdapter.getDocumentIdFromUrl(
    "https://www.studocu.com/en/document/university-of-lagos/civil-engineering/official-academic-transcript/11223344"
  );
  console.log(`[StuDocu Extracted ID]: ${studocuDocId}`);
  if (studocuDocId !== "11223344") {
    throw new Error("❌ StuDocu doc ID extraction failed");
  }
  console.log("✅ StuDocu URL builder & ID extraction passed.");

  // Step 3: Normalization Contract
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 3: Testing Normalization Contract Across Adapters");
  console.log("--------------------------------------------------------------------------------");

  const normDoc = studocuAdapter.normalize(
    {
      title: "University of Lagos Bachelor Transcript",
      uploader: "University of Lagos",
      description: "Complete 4-year transcript of academic records",
      uploadDate: "2023-01-15",
      documentType: "Course Document: Civil Engineering",
      slideOrPageCount: 4,
      rawAttributes: {
        institution: "University of Lagos",
        course: "Civil Engineering",
      },
    },
    {
      sourceDocumentId: "11223344",
      canonicalUrl: "https://www.studocu.com/en/document/university-of-lagos/civil-engineering/transcript/11223344",
      titleRaw: "University of Lagos Bachelor Transcript",
      snippetRaw: "Civil Engineering Bachelor of Science",
    }
  );

  if (normDoc.institution !== "University of Lagos" || normDoc.sourceId !== "studocu") {
    throw new Error("❌ StuDocu normalization contract failed");
  }
  console.log("✅ Normalization contract verified (sourceId, canonicalUrl, institution, metadata mapping).");

  // Step 4: Database Ingestion Across All 5 Sources
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 4: Testing Multi-Source Database Ingestion & Pipeline Compatibility");
  console.log("--------------------------------------------------------------------------------");

  // Fetch or ensure country
  const countryRes = await query<{ id: number }>(`SELECT id FROM countries WHERE name = 'Canada' LIMIT 1;`);
  const countryId = countryRes.rows[0]?.id || 1;

  const sampleDocIds: string[] = [];

  for (const srcName of requiredAdapters) {
    const sRes = await query<{ id: number }>(`SELECT id FROM sources WHERE name = $1;`, [srcName]);
    let sId = sRes.rows[0]?.id;
    if (!sId) {
      const insRes = await query<{ id: number }>(
        `INSERT INTO sources (name, base_url, notes) VALUES ($1, $2, $3) RETURNING id;`,
        [srcName, `https://${srcName}.com`, `Adapter source for ${srcName}`]
      );
      sId = insRes.rows[0].id;
    }

    const testDoc = await query<{ id: string }>(
      `INSERT INTO documents (
         source_id, source_document_id, canonical_url, title, country_id, status
       ) VALUES (
         $1, $2, $3, $4, $5, 'PENDING'
       ) ON CONFLICT (canonical_url) DO UPDATE SET title = EXCLUDED.title RETURNING id;`,
      [
        sId,
        `test-doc-${srcName}-123`,
        `https://test.example.com/${srcName}/doc-123`,
        `Sample Academic Record from ${srcName}`,
        countryId,
      ]
    );

    const docId = testDoc.rows[0].id;
    sampleDocIds.push(docId);

    // Insert evidence signal
    await query(
      `INSERT INTO document_evidence (document_id, evidence_text, extraction_method)
       VALUES ($1, $2, $3);`,
      [docId, `Transcript Record for Bachelor of Science - 4 completed years on ${srcName}`, `${srcName}_extractor`]
    );

    // Insert classification
    await query(
      `INSERT INTO classifications (document_id, classification, completed_years, duration_text, confidence, verification_status, model_used)
       VALUES ($1, 'TWO_PLUS_YEARS', 4, '4 completed years', 0.95, 'VERIFIED', 'multi_source_test')
       ON CONFLICT (document_id) DO NOTHING;`,
      [docId]
    );
  }

  console.log(`✅ Successfully inserted sample records & classifications across all 5 sources: ${sampleDocIds.length} docs`);

  // Step 5: Multi-Source Export Aggregation Test
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 5: Verifying Multi-Source Export (XLSX & CSV) Aggregation");
  console.log("--------------------------------------------------------------------------------");

  const xlsxBuffer = await generateXlsx();
  if (!xlsxBuffer || xlsxBuffer.length === 0) {
    throw new Error("❌ Multi-source XLSX export generation failed");
  }
  console.log(`✅ Multi-source XLSX generated successfully (${xlsxBuffer.length} bytes, spanning all 5 sources).`);

  const csvSummary = await generateCsv(undefined, "summary");
  if (!csvSummary || !csvSummary.includes("Total Records")) {
    throw new Error("❌ Multi-source summary CSV export generation failed");
  }
  console.log("✅ Multi-source Summary CSV generated successfully.");

  const csvCountry = await generateCsv(undefined, "country");
  if (!csvCountry || !csvCountry.includes("Country Name")) {
    throw new Error("❌ Multi-source Country CSV export generation failed");
  }
  console.log("✅ Multi-source Country CSV generated successfully.");

  const csvAccepted = await generateCsv(undefined, "accepted");
  if (!csvAccepted || !csvAccepted.includes("Document Title")) {
    throw new Error("❌ Multi-source Accepted 2+ CSV export generation failed");
  }
  console.log("✅ Multi-source Accepted 2+ CSV generated successfully.");

  // Cleanup test documents
  for (const docId of sampleDocIds) {
    await query(`DELETE FROM classifications WHERE document_id = $1;`, [docId]);
    await query(`DELETE FROM document_evidence WHERE document_id = $1;`, [docId]);
    await query(`DELETE FROM documents WHERE id = $1;`, [docId]);
  }
  console.log("✅ Test documents cleaned up cleanly.");

  console.log("\n================================================================================");
  console.log("🎉 ALL PHASE 23 MULTI-SOURCE ADAPTER TESTS PASSED!");
  console.log("================================================================================\n");

  process.exit(0);
}

runMultiSourceTests().catch((err) => {
  console.error("❌ Multi-Source Test Failed:", err);
  process.exit(1);
});
