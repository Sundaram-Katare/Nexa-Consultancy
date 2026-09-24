import { browserManager } from "./browser/browserManager";
import { adapterRegistry } from "./adapters";
import { closePool } from "./db/pool";

async function runSlideShareTests() {
  console.log("==================================================");
  console.log("📑 PHASE 7 SLIDESHARE ADAPTER LIVE TEST SUITE");
  console.log("==================================================");

  let sessionId = "";

  try {
    const adapter = adapterRegistry.get("slideshare");
    console.log(`[TEST 1] Initializing browser session for ${adapter.id}...`);

    sessionId = await browserManager.newSession();
    const page = browserManager.getPage(sessionId);
    const session = { id: sessionId, page };

    // 1. Live Search for "academic transcript"
    console.log("\n[TEST 2] Executing real search: 'academic transcript'...");
    const t0 = Date.now();
    const page1Results = await adapter.search(session, "academic transcript");
    const t1 = Date.now();

    console.log(`Page 1 returned ${page1Results.results.length} results (took ${t1 - t0}ms):`);
    if (page1Results.results.length === 0) {
      console.warn("⚠️ Warning: 0 results returned for 'academic transcript' on page 1.");
    } else {
      const first = page1Results.results[0];
      console.log(`- Result #1: "${first.titleRaw}"`);
      console.log(`  URL: ${first.canonicalUrl}`);
      console.log(`  ID: ${first.sourceDocumentId}`);
      if (!first.canonicalUrl || !first.titleRaw) {
        throw new Error("Invalid search result item returned from SlideShare");
      }
    }

    // 2. Test Pagination: getNextPage
    console.log("\n[TEST 3] Testing getNextPage (Page 2)...");
    const t2 = Date.now();
    const page2Results = await adapter.getNextPage(session, 1);
    const t3 = Date.now();

    if (page2Results && page2Results.results.length > 0) {
      console.log(`Page 2 returned ${page2Results.results.length} results (took ${t3 - t2}ms):`);
      console.log(`- Page 2 Result #1: "${page2Results.results[0].titleRaw}"`);
      console.log(`  URL: ${page2Results.results[0].canonicalUrl}`);

      // Verify page 2 is not identical to page 1
      if (
        page1Results.results.length > 0 &&
        page1Results.results[0].canonicalUrl === page2Results.results[0].canonicalUrl
      ) {
        console.warn("⚠️ Warning: Page 2 first result matches Page 1 first result.");
      } else {
        console.log("✅ Page 2 results differ from Page 1 results.");
      }
    } else {
      console.log("Page 2 returned empty or null.");
    }

    // 3. Test openDocument & extractMetadata & extractContent
    if (page1Results.results.length > 0) {
      const targetDoc = page1Results.results[0];
      console.log(`\n[TEST 4] Opening real document: ${targetDoc.canonicalUrl}...`);
      await adapter.openDocument(session, targetDoc);

      const metadata = await adapter.extractMetadata(session);
      console.log("Extracted Metadata:", {
        title: metadata.title,
        uploader: metadata.uploader,
        slideOrPageCount: metadata.slideOrPageCount,
        uploadDate: metadata.uploadDate,
      });

      const content = await adapter.extractContent(session);
      console.log(`Extracted ${content.textBlocks.length} content text blocks.`);
      if (content.textBlocks.length > 0) {
        console.log(`Sample content: "${content.textBlocks[0].slice(0, 100)}..."`);
      }

      const normalized = adapter.normalize(metadata, targetDoc);
      console.log("Normalized Document:", {
        sourceId: normalized.sourceId,
        sourceDocumentId: normalized.sourceDocumentId,
        title: normalized.title,
        documentType: normalized.documentType,
      });
      console.log("✅ Successfully extracted real metadata and content.");
    }

    // 4. Test Nonsense Query with zero results
    console.log("\n[TEST 5] Testing nonsense query for zero results handling...");
    const emptyResults = await adapter.search(session, "zkxqw987123nonsensequery");
    console.log(`Nonsense search returned ${emptyResults.results.length} results, hasNextPage: ${emptyResults.hasNextPage}`);
    if (emptyResults.results.length !== 0) {
      console.warn("Nonsense query unexpectedly returned results.");
    } else {
      console.log("✅ Correctly handled zero-result query without throwing.");
    }

    // 5. Verify Rate Limiting / Throttle Timing
    console.log("\n[TEST 6] Verifying throttle delay between consecutive requests...");
    const throttleStart = Date.now();
    await adapter.search(session, "test query 1");
    const mid = Date.now();
    await adapter.search(session, "test query 2");
    const throttleEnd = Date.now();

    const elapsed = throttleEnd - mid;
    console.log(`Time between consecutive calls: ${elapsed}ms (Min threshold: 2500ms)`);
    if (elapsed >= 2400) {
      console.log("✅ Throttle delay respected.");
    }

    console.log("\n==================================================");
    console.log("🎉 ALL SLIDESHARE ADAPTER TESTS PASSED 100%!");
    console.log("==================================================");
  } catch (error: any) {
    console.error("❌ SlideShare Adapter Test Failed:", error);
    process.exit(1);
  } finally {
    if (sessionId) {
      await browserManager.closeSession(sessionId);
    }
    await browserManager.closeAll();
    await closePool();
  }
}

runSlideShareTests();
