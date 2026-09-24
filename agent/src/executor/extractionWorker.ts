import { browserManager } from "../browser/browserManager";
import { adapterRegistry } from "../adapters";
import {
  getPendingDocuments,
  updateDocumentExtracted,
  insertDocumentEvidence,
  recordExtractionFailure,
  DocumentRow,
} from "../db/queries/documents";

export interface ExtractedDocumentResult {
  id: string;
  canonicalUrl: string;
  title: string | null;
  status: string;
  evidenceCount?: number;
  attempts?: number;
  error?: string;
}

export interface ExtractionSummary {
  sourceId: string;
  totalProcessed: number;
  extractedCount: number;
  failedCount: number;
  documents: ExtractedDocumentResult[];
}

/**
 * Worker that pulls PENDING documents discovered by search tasks,
 * opens each in a headless browser, extracts metadata and content text,
 * saves evidence rows, and manages retry / failure thresholds.
 */
export async function processPendingDocuments(
  sourceId: string,
  limit: number = 5
): Promise<ExtractionSummary> {
  const normalizedSource = sourceId.trim().toLowerCase();
  console.log(
    `[EXTRACTION_WORKER] Fetching up to ${limit} PENDING documents for source '${normalizedSource}'...`
  );

  // 1. Query pending documents from database
  const pendingDocs = await getPendingDocuments(normalizedSource, limit);

  if (pendingDocs.length === 0) {
    console.log(`[EXTRACTION_WORKER] No PENDING documents found for source '${normalizedSource}'.`);
    return {
      sourceId: normalizedSource,
      totalProcessed: 0,
      extractedCount: 0,
      failedCount: 0,
      documents: [],
    };
  }

  console.log(
    `[EXTRACTION_WORKER] Found ${pendingDocs.length} PENDING documents to extract.`
  );

  // 2. Resolve source adapter
  const adapter = adapterRegistry.get(normalizedSource);

  // 3. Acquire isolated browser session
  let sessionId: string | null = null;
  const results: ExtractedDocumentResult[] = [];
  let extractedCount = 0;
  let failedCount = 0;

  try {
    sessionId = await browserManager.newSession();
    const page = browserManager.getPage(sessionId);
    const session = { id: sessionId, page };

    // 4. Sequential extraction loop
    for (const doc of pendingDocs) {
      console.log(
        `[EXTRACTION_WORKER] Processing doc ${doc.id} (Attempt ${(doc.extraction_attempts || 0) + 1}/3): ${doc.canonical_url}`
      );

      try {
        // Open document page
        await adapter.openDocument(session, {
          sourceDocumentId: doc.source_document_id,
          canonicalUrl: doc.canonical_url,
          titleRaw: doc.title || "",
          snippetRaw: null,
        });

        // Extract metadata
        const metadata = await adapter.extractMetadata(session);

        // Extract content / transcript
        const content = await adapter.extractContent(session);

        // Update document to EXTRACTED with metadata
        await updateDocumentExtracted(doc.id, metadata);

        // Insert evidence blocks
        let evidenceCount = 0;
        if (content && content.textBlocks && content.textBlocks.length > 0) {
          evidenceCount = await insertDocumentEvidence(
            doc.id,
            content.textBlocks,
            content.extractionMethod || "dom-text"
          );
        } else if (metadata.description && metadata.description.trim().length > 10) {
          // If no transcript blocks but metadata has description, record it as evidence
          evidenceCount = await insertDocumentEvidence(
            doc.id,
            [metadata.description.trim()],
            "metadata-description"
          );
        }

        extractedCount++;
        results.push({
          id: doc.id,
          canonicalUrl: doc.canonical_url,
          title: metadata.title || doc.title,
          status: "EXTRACTED",
          evidenceCount,
        });

        console.log(
          `[EXTRACTION_WORKER] ✅ Document ${doc.id} extracted successfully. (Evidence blocks: ${evidenceCount})`
        );
      } catch (err: any) {
        failedCount++;
        const errorMessage = err.message || "Unknown extraction error";
        console.error(
          `[EXTRACTION_WORKER] ❌ Failed to extract doc ${doc.id}: ${errorMessage}`
        );

        // Record failure and increment retry counter
        const failureResult = await recordExtractionFailure(doc.id, errorMessage, 3);

        results.push({
          id: doc.id,
          canonicalUrl: doc.canonical_url,
          title: doc.title,
          status: failureResult.status,
          attempts: failureResult.attempts,
          error: errorMessage,
        });
      }
    }
  } finally {
    if (sessionId) {
      await browserManager.closeSession(sessionId);
    }
  }

  const summary: ExtractionSummary = {
    sourceId: normalizedSource,
    totalProcessed: pendingDocs.length,
    extractedCount,
    failedCount,
    documents: results,
  };

  console.log(
    `[EXTRACTION_WORKER] Extraction batch completed: ${extractedCount} extracted, ${failedCount} failed of ${pendingDocs.length} total.`
  );

  return summary;
}
