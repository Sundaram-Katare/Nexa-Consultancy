import { query } from "../db/pool";
import { normalizeTitle, normalizeInstitution } from "./normalize";

export interface CandidateDocument {
  sourceId: number;
  sourceDocId: string | null;
  canonicalUrl: string;
  title: string;
  countryId: number;
  institution?: string | null;
  educationLevel?: string | null;
  program?: string | null;
  documentType?: string | null;
}

export interface DuplicateResult {
  inserted: boolean;
  documentId: string;
  isDuplicate: boolean;
  duplicateOf: string | null;
  reason: "exact_source_id" | "exact_url" | "title_institution_match" | null;
  confidence: number;
}

export class DeduplicationService {
  /**
   * Evaluates candidate document across all 3 deduplication tiers:
   * Level 1: Exact (source_id, source_document_id) match
   * Level 2: Exact canonical_url match
   * Level 3: Normalized title + institution similarity (flagged, not merged)
   */
  public async checkDuplicateAndIngest(
    candidate: CandidateDocument
  ): Promise<DuplicateResult> {
    try {
      // 1. Attempt to insert candidate into documents table
      const res = await query<{ id: string }>(
        `INSERT INTO documents (
           source_id, source_document_id, canonical_url, title, 
           country_id, institution, education_level, program, document_type, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
         RETURNING id;`,
        [
          candidate.sourceId,
          candidate.sourceDocId || null,
          candidate.canonicalUrl,
          candidate.title,
          candidate.countryId,
          candidate.institution || null,
          candidate.educationLevel || null,
          candidate.program || null,
          candidate.documentType || null,
        ]
      );

      const newId = res.rows[0].id;

      // 2. Level 3 Check: Only runs for freshly inserted documents
      const level3Match = await this.evaluateLevel3Match(newId, candidate);
      if (level3Match) {
        return {
          inserted: true,
          documentId: newId,
          isDuplicate: true,
          duplicateOf: level3Match.duplicateOf,
          reason: "title_institution_match",
          confidence: 0.6,
        };
      }

      return {
        inserted: true,
        documentId: newId,
        isDuplicate: false,
        duplicateOf: null,
        reason: null,
        confidence: 0,
      };
    } catch (err: any) {
      if (err.code === "23505") {
        // Postgres unique violation error
        return await this.handleUniqueViolation(candidate, err);
      }

      console.error("[DEDUP] Unexpected error inserting document:", err.message);
      throw err;
    }
  }

  /**
   * Resolves Level 1 or Level 2 duplicates upon encountering a unique constraint violation.
   */
  private async handleUniqueViolation(
    candidate: CandidateDocument,
    err: any
  ): Promise<DuplicateResult> {
    // Level 1: Check match on (source_id, source_document_id)
    if (candidate.sourceDocId) {
      const level1Res = await query<{ id: string }>(
        `SELECT id FROM documents 
         WHERE source_id = $1 AND source_document_id = $2 
         LIMIT 1;`,
        [candidate.sourceId, candidate.sourceDocId]
      );

      if (level1Res.rows.length > 0) {
        const existingId = level1Res.rows[0].id;
        console.log(
          `[DEDUP] Level 1 exact match (source_document_id '${candidate.sourceDocId}') -> Document ${existingId}`
        );
        return {
          inserted: false,
          documentId: existingId,
          isDuplicate: true,
          duplicateOf: existingId,
          reason: "exact_source_id",
          confidence: 1.0,
        };
      }
    }

    // Level 2: Check match on canonical_url
    const level2Res = await query<{ id: string }>(
      `SELECT id FROM documents 
       WHERE canonical_url = $1 
       LIMIT 1;`,
      [candidate.canonicalUrl]
    );

    if (level2Res.rows.length > 0) {
      const existingId = level2Res.rows[0].id;
      console.log(
        `[DEDUP] Level 2 exact match (canonical_url '${candidate.canonicalUrl}') -> Document ${existingId}`
      );
      return {
        inserted: false,
        documentId: existingId,
        isDuplicate: true,
        duplicateOf: existingId,
        reason: "exact_url",
        confidence: 1.0,
      };
    }

    throw new Error(`Unique constraint violation but existing record not found: ${err.message}`);
  }

  /**
   * Evaluates Level 3 near-duplicate candidates (Normalized Title AND Normalized Institution match).
   * Flags the new document with duplicate_of and writes an audit_logs entry without auto-merging.
   */
  public async evaluateLevel3Match(
    newDocumentId: string,
    candidate: { title?: string | null; institution?: string | null; countryId?: number | null }
  ): Promise<{ duplicateOf: string } | null> {
    const normTitle = normalizeTitle(candidate.title);
    const normInst = normalizeInstitution(candidate.institution);

    // Both title AND institution must be present and non-empty for Level 3
    if (!normTitle || !normInst || !candidate.countryId) {
      return null;
    }

    // Query existing documents in the same country that have both title and institution
    const existingDocs = await query<{ id: string; title: string; institution: string }>(
      `SELECT id, title, institution 
       FROM documents 
       WHERE country_id = $1 
         AND id != $2 
         AND title IS NOT NULL 
         AND institution IS NOT NULL
       ORDER BY created_at ASC;`,
      [candidate.countryId, newDocumentId]
    );

    for (const existing of existingDocs.rows) {
      const existingNormTitle = normalizeTitle(existing.title);
      const existingNormInst = normalizeInstitution(existing.institution);

      if (existingNormTitle === normTitle && existingNormInst === normInst) {
        console.log(
          `[DEDUP] Level 3 soft match found: doc ${newDocumentId} matches existing doc ${existing.id} (Title: "${normTitle}", Inst: "${normInst}")`
        );

        // Flag the new row with duplicate metadata (leaves both rows intact)
        await query(
          `UPDATE documents 
           SET duplicate_of = $1,
               duplicate_reason = 'title_institution_match',
               duplicate_confidence = 0.6
           WHERE id = $2;`,
          [existing.id, newDocumentId]
        );

        // Record entry in audit_logs for human reviewer tracking
        await query(
          `INSERT INTO audit_logs (entity_type, entity_id, action, details, created_at)
           VALUES ('documents', $1, 'FLAG_LEVEL_3_DUPLICATE', $2, NOW());`,
          [
            newDocumentId,
            JSON.stringify({
              candidateId: newDocumentId,
              duplicateOf: existing.id,
              rawTitle: candidate.title,
              rawInstitution: candidate.institution,
              normalizedTitle: normTitle,
              normalizedInstitution: normInst,
              confidence: 0.6,
            }),
          ]
        );

        return { duplicateOf: existing.id };
      }
    }

    return null;
  }
}

export const deduplicationService = new DeduplicationService();
