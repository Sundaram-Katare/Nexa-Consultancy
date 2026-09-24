import { query } from "../pool";
import { RawMetadata } from "../../adapters/types";

export interface DocumentRow {
  id: string;
  source_id: number;
  source_name?: string;
  source_document_id: string | null;
  canonical_url: string;
  title: string | null;
  country_id: number | null;
  country_name?: string | null;
  institution: string | null;
  education_level: string | null;
  program: string | null;
  document_type: string | null;
  status: "PENDING" | "EXTRACTED" | "EXTRACTION_FAILED" | "CLASSIFIED";
  extraction_attempts: number;
  raw_metadata: any;
  created_at: string;
}

export interface DocumentEvidenceRow {
  id: string;
  document_id: string;
  evidence_text: string;
  location_ref: string | null;
  extraction_method: string | null;
  extracted_at: string;
}

/**
 * Queries up to `limit` documents in PENDING status for the specified source.
 */
export async function getPendingDocuments(
  sourceId: string | number,
  limit: number = 10
): Promise<DocumentRow[]> {
  const sourceParam = sourceId.toString().toLowerCase();
  const res = await query<DocumentRow>(
    `SELECT 
       d.id, d.source_id, s.name as source_name, d.source_document_id, d.canonical_url,
       d.title, d.country_id, c.name as country_name, d.institution, d.education_level,
       d.program, d.document_type, d.status, COALESCE(d.extraction_attempts, 0) as extraction_attempts, 
       d.raw_metadata, d.created_at
     FROM documents d
     JOIN sources s ON d.source_id = s.id
     LEFT JOIN countries c ON d.country_id = c.id
     WHERE d.status = 'PENDING'
       AND (LOWER(s.name) = $1 OR s.id::text = $1)
     ORDER BY d.created_at ASC
     LIMIT $2;`,
    [sourceParam, limit]
  );
  return res.rows;
}

/**
 * Retrieves a single document by its UUID.
 */
export async function getDocumentById(id: string): Promise<DocumentRow | null> {
  const res = await query<DocumentRow>(
    `SELECT 
       d.id, d.source_id, s.name as source_name, d.source_document_id, d.canonical_url,
       d.title, d.country_id, c.name as country_name, d.institution, d.education_level,
       d.program, d.document_type, d.status, COALESCE(d.extraction_attempts, 0) as extraction_attempts, 
       d.raw_metadata, d.created_at
     FROM documents d
     JOIN sources s ON d.source_id = s.id
     LEFT JOIN countries c ON d.country_id = c.id
     WHERE d.id = $1;`,
    [id]
  );
  return res.rows[0] || null;
}

/**
 * Updates a document row after successful extraction.
 * Leaves institution/education_level/program/document_type untouched for downstream classifier.
 */
export async function updateDocumentExtracted(
  id: string,
  metadata: RawMetadata
): Promise<void> {
  await query(
    `UPDATE documents 
     SET status = 'EXTRACTED',
         title = COALESCE(NULLIF($2, ''), title),
         raw_metadata = $3
     WHERE id = $1;`,
    [id, metadata.title || null, JSON.stringify(metadata)]
  );
}

/**
 * Inserts extracted text blocks into document_evidence.
 */
export async function insertDocumentEvidence(
  documentId: string,
  textBlocks: string[],
  extractionMethod: string = "dom-text"
): Promise<number> {
  if (!textBlocks || textBlocks.length === 0) {
    return 0;
  }

  let insertedCount = 0;
  for (let i = 0; i < textBlocks.length; i++) {
    const text = textBlocks[i]?.trim();
    if (!text) continue;

    await query(
      `INSERT INTO document_evidence (
         document_id, evidence_text, location_ref, extraction_method, extracted_at
       ) VALUES ($1, $2, $3, $4, NOW());`,
      [documentId, text, `block_${i + 1}`, extractionMethod]
    );
    insertedCount++;
  }

  return insertedCount;
}

/**
 * Records an extraction failure.
 * Increments extraction_attempts and transitions status to EXTRACTION_FAILED if attempts >= maxAttempts (default 3).
 * Always logs the failure to the errors table with category EXTRACTION_ERROR.
 */
export async function recordExtractionFailure(
  documentId: string,
  errorMessage: string,
  maxAttempts: number = 3
): Promise<{ attempts: number; status: string }> {
  // 1. Increment attempts and conditionally update status
  const res = await query<{ extraction_attempts: number; status: string }>(
    `UPDATE documents 
     SET extraction_attempts = COALESCE(extraction_attempts, 0) + 1,
         status = CASE 
           WHEN COALESCE(extraction_attempts, 0) + 1 >= $2 THEN 'EXTRACTION_FAILED' 
           ELSE 'PENDING' 
         END
     WHERE id = $1
     RETURNING extraction_attempts, status;`,
    [documentId, maxAttempts]
  );

  const row = res.rows[0];
  const attempts = row?.extraction_attempts ?? 1;
  const status = row?.status ?? "PENDING";

  // 2. Log entry to errors table
  await query(
    `INSERT INTO errors (document_id, error_category, message, retry_count, occurred_at)
     VALUES ($1, 'EXTRACTION_ERROR', $2, $3, NOW());`,
    [documentId, errorMessage, attempts]
  );

  return { attempts, status };
}

/**
 * Retrieves all evidence records for a given document.
 */
export async function getDocumentEvidence(
  documentId: string
): Promise<DocumentEvidenceRow[]> {
  const res = await query<DocumentEvidenceRow>(
    `SELECT id, document_id, evidence_text, location_ref, extraction_method, extracted_at
     FROM document_evidence
     WHERE document_id = $1
     ORDER BY extracted_at ASC;`,
    [documentId]
  );
  return res.rows;
}

/**
 * Retrieves all error logs associated with a document.
 */
export async function getDocumentErrors(documentId: string) {
  const res = await query(
    `SELECT id, document_id, error_category, message, retry_count, occurred_at
     FROM errors
     WHERE document_id = $1
     ORDER BY occurred_at DESC;`,
    [documentId]
  );
  return res.rows;
}
