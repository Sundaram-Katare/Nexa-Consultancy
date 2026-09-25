import { browserManager } from "../browser/browserManager";
import { adapterRegistry } from "../adapters";
import {
  getPendingDocuments,
  updateDocumentExtracted,
  insertDocumentEvidence,
  DocumentRow,
} from "../db/queries/documents";
import { query } from "../db/pool";
import { saveCheckpoint } from "../pipeline/checkpointService";
import { withRetry, PipelineExecutionError } from "../errors";

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
 * saves evidence rows, and uses unified withRetry policy.
 */
export async function processPendingDocuments(
  sourceId: string,
  limit: number = 5,
  jobId?: string
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
    for (let index = 0; index < pendingDocs.length; index++) {
      const doc = pendingDocs[index];
      console.log(
        `[EXTRACTION_WORKER] Processing doc ${doc.id}: ${doc.canonical_url}`
      );

      try {
        let evidenceCount = 0;

        await withRetry(
          async () => {
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
            if (content && content.textBlocks && content.textBlocks.length > 0) {
              evidenceCount = await insertDocumentEvidence(
                doc.id,
                content.textBlocks,
                content.extractionMethod || "dom-text"
              );
            } else if (metadata.description && metadata.description.trim().length > 10) {
              evidenceCount = await insertDocumentEvidence(
                doc.id,
                [metadata.description.trim()],
                "metadata-description"
              );
            }
          },
          "EXTRACTION_ERROR",
          {
            jobId,
            documentId: doc.id,
            action: "extract_document",
          }
        );

        extractedCount++;
        results.push({
          id: doc.id,
          canonicalUrl: doc.canonical_url,
          title: doc.title,
          status: "EXTRACTED",
          evidenceCount,
        });

        console.log(
          `[EXTRACTION_WORKER] ✅ Document ${doc.id} extracted successfully. (Evidence blocks: ${evidenceCount})`
        );

        if (jobId) {
          await saveCheckpoint(
            jobId,
            null,
            null,
            index + 1,
            "RUNNING",
            "EXTRACTION"
          );
        }
      } catch (err: any) {
        failedCount++;
        const errorMessage = err.message || "Unknown extraction error";
        console.error(
          `[EXTRACTION_WORKER] ❌ Failed to extract doc ${doc.id} after retries exhausted: ${errorMessage}`
        );

        const attempts = err instanceof PipelineExecutionError ? err.attempts : 1;

        // Transition document to EXTRACTION_FAILED in DB
        await query(
          `UPDATE documents 
           SET status = 'EXTRACTION_FAILED', 
               extraction_attempts = COALESCE(extraction_attempts, 0) + $2 
           WHERE id = $1;`,
          [doc.id, attempts]
        );

        results.push({
          id: doc.id,
          canonicalUrl: doc.canonical_url,
          title: doc.title,
          status: "EXTRACTION_FAILED",
          attempts,
          error: errorMessage,
        });

        if (jobId) {
          await saveCheckpoint(
            jobId,
            null,
            null,
            index + 1,
            "RUNNING",
            "EXTRACTION"
          );
        }
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
