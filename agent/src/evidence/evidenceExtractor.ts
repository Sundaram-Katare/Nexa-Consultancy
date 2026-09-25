import { query } from "../db/pool";
import { getDocumentById, getDocumentEvidence } from "../db/queries/documents";
import { findSignalsInText, SignalType } from "./patterns";
import { withRetry } from "../errors";

export interface EvidenceSignalRow {
  id: string;
  document_id: string;
  document_evidence_id: string | null;
  signal_type: SignalType;
  raw_text: string;
  extracted_value: string | null;
  location_ref: string | null;
  created_at: string;
}

export interface DocumentSignalsResult {
  documentId: string;
  title: string | null;
  canonicalUrl: string;
  signalsCount: number;
  signals: EvidenceSignalRow[];
}

export interface BatchEvidenceSummary {
  totalProcessed: number;
  totalSignalsExtracted: number;
  documents: DocumentSignalsResult[];
}

/**
 * Extracts structured duration signals from all evidence text blocks of a document.
 * Idempotently inserts signals into the evidence_signals table with retry resilience.
 */
export async function extractDurationSignals(
  documentId: string,
  jobId?: string
): Promise<EvidenceSignalRow[]> {
  return await withRetry(
    async () => {
      const doc = await getDocumentById(documentId);
      if (!doc) {
        throw new Error(`Document with ID '${documentId}' was not found.`);
      }

      // 1. Fetch raw evidence text blocks
      const evidenceRows = await getDocumentEvidence(documentId);
      console.log(
        `[EVIDENCE_EXTRACTOR] Analyzing ${evidenceRows.length} evidence blocks for doc ${documentId}...`
      );

      // 2. Scan each evidence block with explicit patterns
      for (const row of evidenceRows) {
        const signals = findSignalsInText(row.evidence_text);

        for (const signal of signals) {
          await query(
            `INSERT INTO evidence_signals (
               document_id, document_evidence_id, signal_type, raw_text, extracted_value, location_ref
             ) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (document_id, signal_type, raw_text) DO UPDATE 
             SET extracted_value = EXCLUDED.extracted_value,
                 location_ref = EXCLUDED.location_ref;`,
            [
              documentId,
              row.id,
              signal.signalType,
              signal.rawText,
              signal.extractedValue,
              row.location_ref || "body_text",
            ]
          );
        }
      }

      // 3. Scan metadata description if present
      if (doc.raw_metadata?.description) {
        const descSignals = findSignalsInText(doc.raw_metadata.description);
        for (const signal of descSignals) {
          await query(
            `INSERT INTO evidence_signals (
               document_id, document_evidence_id, signal_type, raw_text, extracted_value, location_ref
             ) VALUES ($1, NULL, $2, $3, $4, 'metadata_description')
             ON CONFLICT (document_id, signal_type, raw_text) DO UPDATE 
             SET extracted_value = EXCLUDED.extracted_value,
                 location_ref = EXCLUDED.location_ref;`,
            [documentId, signal.signalType, signal.rawText, signal.extractedValue]
          );
        }
      }

      // 4. Return all persisted signals for this document
      return await getEvidenceSignals(documentId);
    },
    "EXTRACTION_ERROR",
    {
      jobId,
      documentId,
      action: "extract_duration_signals",
    }
  );
}

/**
 * Runs batch evidence signal extraction over all CLASSIFIED_PENDING documents.
 */
export async function extractDurationSignalsBatch(
  sourceId?: string,
  limit: number = 20,
  jobId?: string
): Promise<BatchEvidenceSummary> {
  console.log(
    `[EVIDENCE_EXTRACTOR] Running batch extraction for CLASSIFIED_PENDING documents (source: ${sourceId || "ALL"}, limit: ${limit})...`
  );

  let queryText = `
    SELECT d.id, d.source_id, s.name as source_name, d.canonical_url, d.title
    FROM documents d
    JOIN sources s ON d.source_id = s.id
    WHERE d.status = 'CLASSIFIED_PENDING'
  `;
  const params: any[] = [];

  if (sourceId) {
    params.push(sourceId.toLowerCase());
    queryText += ` AND (LOWER(s.name) = $1 OR s.id::text = $1) `;
  }

  params.push(limit);
  queryText += ` ORDER BY d.created_at ASC LIMIT $${params.length};`;

  const res = await query<{
    id: string;
    source_id: number;
    source_name: string;
    canonical_url: string;
    title: string | null;
  }>(queryText, params);

  const docs = res.rows;
  console.log(`[EVIDENCE_EXTRACTOR] Found ${docs.length} CLASSIFIED_PENDING documents to extract signals from.`);

  let totalSignalsExtracted = 0;
  const results: DocumentSignalsResult[] = [];

  for (const doc of docs) {
    const signals = await extractDurationSignals(doc.id, jobId);
    totalSignalsExtracted += signals.length;

    results.push({
      documentId: doc.id,
      title: doc.title,
      canonicalUrl: doc.canonical_url,
      signalsCount: signals.length,
      signals,
    });
  }

  return {
    totalProcessed: docs.length,
    totalSignalsExtracted,
    documents: results,
  };
}

/**
 * Retrieves all extracted evidence signals for a given document.
 */
export async function getEvidenceSignals(
  documentId: string
): Promise<EvidenceSignalRow[]> {
  const res = await query<EvidenceSignalRow>(
    `SELECT id, document_id, document_evidence_id, signal_type, raw_text, extracted_value, location_ref, created_at
     FROM evidence_signals
     WHERE document_id = $1
     ORDER BY created_at ASC;`,
    [documentId]
  );
  return res.rows;
}
