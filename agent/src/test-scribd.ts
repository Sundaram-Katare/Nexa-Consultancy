import { adapterRegistry } from "./adapters";
import { ScribdAdapter } from "./adapters/scribd/scribdAdapter";
import { ScribdAuthManager } from "./adapters/scribd/authSession";
import { query } from "./db/pool";

async function runScribdTests() {
  console.log("================================================================================");
  console.log("🧪 PHASE 22 — Scribd Adapter Test Suite");
  console.log("================================================================================\n");

  // Step 1: Registry Verification
  console.log("--------------------------------------------------------------------------------");
  console.log("Step 1: Verifying ScribdAdapter in Adapter Registry");
  console.log("--------------------------------------------------------------------------------");

  const adapter = adapterRegistry.get("scribd");
  if (!adapter) {
    throw new Error("❌ ScribdAdapter was not registered in adapterRegistry!");
  }
  console.log(`✅ ScribdAdapter found in registry: id='${adapter.id}'`);
  console.log(`✅ Registered Adapters: [${adapterRegistry.listIds().join(", ")}]`);

  // Step 2: URL Building & Document ID Extraction
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 2: Testing URL Building & Regex ID Extraction");
  console.log("--------------------------------------------------------------------------------");

  const scribd = adapter as ScribdAdapter;
  const searchUrl = scribd.buildSearchUrl("Ghana transcript", 2);
  console.log(`[Built Search URL]: ${searchUrl}`);
  if (!searchUrl.includes("query=Ghana%20transcript") || !searchUrl.includes("page=2")) {
    throw new Error("❌ Scribd search URL generation mismatch");
  }
  console.log("✅ Search URL correctly formatted with query and page parameters.");

  const docUrl = "https://www.scribd.com/document/543210987/University-Academic-Transcript-Record";
  const docId = scribd.getDocumentIdFromUrl(docUrl);
  console.log(`[Extracted Document ID from "${docUrl}"]: ${docId}`);
  if (docId !== "543210987") {
    throw new Error(`❌ Expected ID '543210987', got '${docId}'`);
  }
  console.log("✅ Document ID extraction regex verified.");

  // Step 3: Auth Session Logic
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 3: Testing Scribd Session Auth Manager");
  console.log("--------------------------------------------------------------------------------");

  const hasCreds = ScribdAuthManager.hasCredentials();
  console.log(`[Credentials Configured]: ${hasCreds ? "YES" : "NO (Public Guest Mode Active)"}`);
  ScribdAuthManager.resetSession();
  console.log("✅ Auth session state reset and checked cleanly.");

  // Step 4: Pipeline Data Layer Compatibility
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 4: Testing Database Ingestion with Scribd Source");
  console.log("--------------------------------------------------------------------------------");

  // Get source_id for scribd
  const srcRes = await query<{ id: number }>(`SELECT id FROM sources WHERE name = 'scribd';`);
  let scribdSourceId = srcRes.rows[0]?.id;
  if (!scribdSourceId) {
    const insertSrc = await query<{ id: number }>(
      `INSERT INTO sources (name, base_url, notes) VALUES ('scribd', 'https://www.scribd.com', 'Scribd document sharing') RETURNING id;`
    );
    scribdSourceId = insertSrc.rows[0].id;
  }
  console.log(`✅ Scribd DB Source ID: ${scribdSourceId}`);

  // Insert mock Scribd document
  const testDocRes = await query<{ id: string }>(
    `INSERT INTO documents (
       source_id, source_document_id, canonical_url, title, status
     ) VALUES (
       $1, '543210987', 'https://www.scribd.com/document/543210987/University-Academic-Transcript', 'University Academic Transcript', 'PENDING'
     ) ON CONFLICT (canonical_url) DO UPDATE SET title = EXCLUDED.title RETURNING id;`,
    [scribdSourceId]
  );
  const scribdDocId = testDocRes.rows[0].id;
  console.log(`✅ Ingested Scribd Document Record: ID=${scribdDocId}`);

  // Insert extracted evidence
  await query(
    `INSERT INTO document_evidence (document_id, evidence_text, extraction_method)
     VALUES ($1, 'Official Academic Transcript of Records - Completed 4 Years Bachelor of Science', 'scribd_reader');`,
    [scribdDocId]
  );
  console.log("✅ Inserted evidence text for Scribd document.");

  // Cleanup
  await query(`DELETE FROM document_evidence WHERE document_id = $1;`, [scribdDocId]);
  await query(`DELETE FROM documents WHERE id = $1;`, [scribdDocId]);

  console.log("\n================================================================================");
  console.log("🎉 ALL PHASE 22 SCRIBD ADAPTER TESTS PASSED!");
  console.log("================================================================================\n");

  process.exit(0);
}

runScribdTests().catch((err) => {
  console.error("❌ Scribd Test Failed:", err);
  process.exit(1);
});
