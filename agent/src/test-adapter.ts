import { BaseSourceAdapter, AdapterError } from "./adapters/baseAdapter";
import { adapterRegistry } from "./adapters/registry";
import {
  SearchResult,
  SearchResultPage,
  RawMetadata,
  RawContent,
  NormalizedDocument,
} from "./adapters/types";
import { query, closePool } from "./db/pool";

/**
 * Throwaway test adapter implementing BaseSourceAdapter with mock responses.
 * (No browser automation required).
 */
class FakeAdapter extends BaseSourceAdapter {
  public readonly id = "fake_source";
  public shouldFailNext = false;
  public failErrorType = "TIMEOUT";

  protected doBuildSearchUrl(queryText: string, page: number): string {
    return `https://fake.example.com/search?q=${encodeURIComponent(queryText)}&page=${page}`;
  }

  protected async doSearch(session: any, queryText: string): Promise<SearchResultPage> {
    if (this.shouldFailNext) {
      if (this.failErrorType === "TIMEOUT") {
        throw new Error("Navigation Timeout of 30000ms exceeded while loading search results");
      }
      if (this.failErrorType === "LOCATOR") {
        throw new Error("waiting for locator '.result-item-card' failed");
      }
      if (this.failErrorType === "RATE_LIMIT") {
        throw new Error("HTTP 429 Too Many Requests received from target server");
      }
      throw new Error("Generic failure during search");
    }

    return {
      results: [
        {
          sourceDocumentId: "FAKE-DOC-001",
          canonicalUrl: "https://fake.example.com/doc/001",
          titleRaw: "University of Toronto Academic Transcript 2020-2024",
          snippetRaw: "Official 4-year transcript showing completed degree",
        },
      ],
      hasNextPage: true,
      pageNumber: 1,
      rawResultCount: 1,
    };
  }

  protected async doGetNextPage(session: any, currentPage: number): Promise<SearchResultPage | null> {
    return {
      results: [
        {
          sourceDocumentId: "FAKE-DOC-002",
          canonicalUrl: "https://fake.example.com/doc/002",
          titleRaw: "Oxford University Statement of Results",
          snippetRaw: "Year 1 and Year 2 marksheet",
        },
      ],
      hasNextPage: false,
      pageNumber: currentPage + 1,
      rawResultCount: 1,
    };
  }

  protected async doOpenDocument(session: any, result: SearchResult): Promise<void> {
    // Mock opening document
    return;
  }

  protected async doExtractMetadata(session: any): Promise<RawMetadata> {
    return {
      title: "University of Toronto Academic Transcript",
      uploader: "registrar_office",
      description: "Official undergraduate academic transcript 4 years",
      uploadDate: "2024-06-15",
      documentType: "Transcript",
      slideOrPageCount: 4,
    };
  }

  protected async doExtractContent(session: any): Promise<RawContent> {
    return {
      textBlocks: [
        "University of Toronto",
        "Faculty of Arts and Science",
        "Year 1: Fall 2020, Winter 2021",
        "Year 2: Fall 2021, Winter 2022",
        "Year 3: Fall 2022, Winter 2023",
        "Year 4: Fall 2023, Winter 2024",
        "Degree Conferred: Bachelor of Science with High Distinction",
      ],
      extractionMethod: "DOM_TEXT_BLOCKS",
      confidence: 0.99,
    };
  }

  protected doNormalize(raw: RawMetadata, searchResult: SearchResult): NormalizedDocument {
    return {
      sourceId: this.id,
      sourceDocumentId: searchResult.sourceDocumentId,
      canonicalUrl: searchResult.canonicalUrl,
      title: raw.title || searchResult.titleRaw,
      institution: "University of Toronto",
      educationLevel: "Bachelor",
      program: "Computer Science",
      documentType: raw.documentType || "Transcript",
      metadata: raw,
    };
  }
}

async function runAdapterTests() {
  console.log("==================================================");
  console.log("🧩 PHASE 6 SOURCE ADAPTER ARCHITECTURE TEST SUITE");
  console.log("==================================================");

  try {
    // 1. Test Registry Registration & Retrieval
    console.log("\n[TEST 1] Registering FakeAdapter in AdapterRegistry...");
    const fake = new FakeAdapter();
    adapterRegistry.register(fake);

    const retrieved = adapterRegistry.get("fake_source");
    if (!retrieved || retrieved.id !== "fake_source") {
      throw new Error("Failed to retrieve registered adapter from registry!");
    }
    console.log(`✅ Successfully registered and retrieved adapter for '${retrieved.id}'.`);

    // 2. Test Nonexistent Adapter Retrieval Exception
    console.log("\n[TEST 2] Testing error handling on unregistered source ID...");
    let threwNonexistent = false;
    try {
      adapterRegistry.get("nonexistent_source_123");
    } catch (err: any) {
      threwNonexistent = true;
      console.log(`✅ Correctly threw error for nonexistent adapter: "${err.message}"`);
    }
    if (!threwNonexistent) {
      throw new Error("Failed to throw error for unregistered adapter!");
    }

    // 3. Test Successful Adapter Operations
    console.log("\n[TEST 3] Driving FakeAdapter through full search & extraction lifecycle...");
    const searchUrl = fake.buildSearchUrl("Canada Transcript", 1);
    console.log(`Built Search URL: ${searchUrl}`);

    const searchResult = await fake.search({}, "Canada Transcript");
    console.log(`Search Results count: ${searchResult.results.length}`);
    if (searchResult.results.length !== 1 || searchResult.results[0].sourceDocumentId !== "FAKE-DOC-001") {
      throw new Error("Unexpected search results from FakeAdapter");
    }

    const doc = searchResult.results[0];
    await fake.openDocument({}, doc);
    const metadata = await fake.extractMetadata({});
    const content = await fake.extractContent({});
    const normalized = fake.normalize(metadata, doc);

    console.log("Normalized Document:", {
      sourceId: normalized.sourceId,
      sourceDocumentId: normalized.sourceDocumentId,
      title: normalized.title,
      institution: normalized.institution,
      educationLevel: normalized.educationLevel,
    });
    console.log("Content Text Blocks count:", content.textBlocks.length);
    console.log("✅ Successful end-to-end operation through generic adapter interface.");

    // 4. Test Error Handling, Classification & DB Error Logging
    console.log("\n[TEST 4] Testing error handling wrapper & database error persistence...");

    // 4a. Timeout error
    fake.shouldFailNext = true;
    fake.failErrorType = "TIMEOUT";

    let timeoutCaught = false;
    try {
      await fake.search({}, "Timeout test query");
    } catch (err: any) {
      if (err instanceof AdapterError && err.category === "NAVIGATION_TIMEOUT") {
        timeoutCaught = true;
        console.log(`✅ Caught typed AdapterError [${err.category}]: ${err.message}`);
      } else {
        throw new Error(`Expected AdapterError with NAVIGATION_TIMEOUT, got ${err}`);
      }
    }
    if (!timeoutCaught) throw new Error("Failed to catch timeout error!");

    // 4b. Element not found error
    fake.failErrorType = "LOCATOR";
    let locatorCaught = false;
    try {
      await fake.search({}, "Locator test query");
    } catch (err: any) {
      if (err instanceof AdapterError && err.category === "ELEMENT_NOT_FOUND") {
        locatorCaught = true;
        console.log(`✅ Caught typed AdapterError [${err.category}]: ${err.message}`);
      } else {
        throw new Error(`Expected AdapterError with ELEMENT_NOT_FOUND, got ${err}`);
      }
    }
    if (!locatorCaught) throw new Error("Failed to catch locator error!");

    // 4c. Verify errors landed in Supabase database errors table
    console.log("\n[TEST 5] Checking logged errors in PostgreSQL/Supabase errors table...");
    const errorsRes = await query(`
      SELECT error_category, message, occurred_at 
      FROM errors 
      WHERE message LIKE '%[fake_source]%' 
      ORDER BY occurred_at DESC 
      LIMIT 5;
    `);

    console.log(`Found ${errorsRes.rows.length} error records in database:`);
    for (const r of errorsRes.rows) {
      console.log(`- [${r.error_category}] ${r.message}`);
    }

    if (errorsRes.rows.length < 2) {
      throw new Error(`Expected at least 2 logged error rows in DB, found ${errorsRes.rows.length}`);
    }
    console.log("✅ Verified that AdapterError automatically persisted errors to Supabase.");

    // Cleanup test errors
    await query(`DELETE FROM errors WHERE message LIKE '%[fake_source]%';`);
    console.log("✅ Cleaned up test error rows.");

    console.log("\n==================================================");
    console.log("🎉 ALL SOURCE ADAPTER ARCHITECTURE TESTS PASSED 100%!");
    console.log("==================================================");
  } catch (error: any) {
    console.error("❌ Adapter Architecture Test Failed:", error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

runAdapterTests();
