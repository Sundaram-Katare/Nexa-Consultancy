import { query } from "../db/pool";
import { getDocumentById } from "../db/queries/documents";
import {
  getEvidenceSignals,
  extractDurationSignals,
} from "../evidence/evidenceExtractor";
import {
  candidateClassification,
  ClassificationCategory,
  ClassificationDecision,
} from "./rules";
import { saveCheckpoint } from "../pipeline/checkpointService";
import { ollamaClient } from "../ai/ollamaClient";
import { ClassificationResponseSchema } from "../ai/schemas";
import { buildClassificationPrompt } from "../ai/prompts/classificationPrompt";

export interface ClassificationRow {
  id: string;
  document_id: string;
  classification: ClassificationCategory;
  completed_years: number | null;
  duration_text: string | null;
  confidence: number;
  verification_status: string;
  model_used: string | null;
  reasoning: string;
  classified_at: string;
}

export interface DocumentClassificationResult {
  documentId: string;
  title: string | null;
  canonicalUrl: string;
  classification: ClassificationCategory;
  completedYears: number | null;
  durationText: string | null;
  confidence: number;
  reasoning: string;
}

export interface BatchClassificationSummary {
  totalProcessed: number;
  twoPlusYearsCount: number;
  lessThanTwoYearsCount: number;
  needsReviewCount: number;
  results: DocumentClassificationResult[];
}

/**
 * Executes deterministic 2-year duration classification for a single document,
 * writes the record into classifications, and advances document status to 'CLASSIFIED'.
 */
export async function classify(documentId: string): Promise<ClassificationRow> {
  const doc = await getDocumentById(documentId);
  if (!doc) {
    throw new Error(`Document with ID '${documentId}' was not found.`);
  }

  // 1. Load evidence signals (extract if not yet done)
  let signals = await getEvidenceSignals(documentId);
  if (signals.length === 0) {
    signals = await extractDurationSignals(documentId);
  }

  console.log(
    `[CLASSIFIER] Classifying document ${documentId} ("${doc.title}") using ${signals.length} evidence signals...`
  );

  // 2. Compute candidate classification decision via deterministic rules
  let decision: ClassificationDecision = candidateClassification(signals);
  let verificationStatus: string = "RULE_BASED";
  let modelUsed: string | null = null;

  // 3. Strict Boundary: Only invoke local AI if evidence signals exist but were ambiguous to regex rules
  // NEVER invoke AI if 0 evidence signals, conflicting evidence, or program length only (anti-hallucination rule)
  const isEligibleForAiResolution =
    decision.classification === "NEEDS_REVIEW" &&
    signals.length > 0 &&
    decision.reasoning !== "no_evidence_found" &&
    decision.reasoning !== "conflicting_evidence" &&
    decision.reasoning !== "program_length_without_completion";

  if (isEligibleForAiResolution) {
    console.log(
      `[CLASSIFIER] Ambiguous evidence format for doc ${documentId}. Invoking Ollama AI with ${signals.length} signals...`
    );
    try {
      const { system, prompt } = buildClassificationPrompt(doc.title || "", signals);
      const aiRes = await ollamaClient.generate(prompt, ClassificationResponseSchema, system);

      verificationStatus = "LLM_ASSISTED";
      modelUsed = process.env.OLLAMA_MODEL || "qwen2.5:3b";
      decision = {
        classification: aiRes.classification,
        completedYears: aiRes.completedYears,
        durationText: decision.durationText,
        confidence: aiRes.confidence,
        reasoning: `[LLM-Assisted]: ${aiRes.reasoning}`,
      };
      console.log(
        `[CLASSIFIER] ✅ AI Classification for doc ${documentId}: [${decision.classification}] (Years: ${decision.completedYears}, Conf: ${decision.confidence})`
      );
    } catch (err: any) {
      console.warn(
        `[CLASSIFIER] ⚠️ Local AI unavailable or invalid response (${err.message}). Retaining deterministic NEEDS_REVIEW.`
      );
      verificationStatus = "RULE_BASED";
      modelUsed = null;
    }
  }

  console.log(
    `[CLASSIFIER] Final Decision: [${decision.classification}] (Years: ${decision.completedYears}, Conf: ${decision.confidence}, Status: ${verificationStatus}, Reason: ${decision.reasoning})`
  );

  // 4. Insert or update classifications table
  const res = await query<ClassificationRow>(
    `INSERT INTO classifications (
       document_id, classification, completed_years, duration_text, 
       confidence, verification_status, model_used, reasoning, classified_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (document_id) DO UPDATE 
     SET classification = EXCLUDED.classification,
         completed_years = EXCLUDED.completed_years,
         duration_text = EXCLUDED.duration_text,
         confidence = EXCLUDED.confidence,
         verification_status = EXCLUDED.verification_status,
         model_used = EXCLUDED.model_used,
         reasoning = EXCLUDED.reasoning,
         classified_at = NOW()
     RETURNING *;`,
    [
      documentId,
      decision.classification,
      decision.completedYears,
      decision.durationText,
      decision.confidence,
      verificationStatus,
      modelUsed,
      decision.reasoning,
    ]
  );

  // 5. Advance document status to 'CLASSIFIED'
  await query(
    `UPDATE documents 
     SET status = 'CLASSIFIED' 
     WHERE id = $1;`,
    [documentId]
  );

  return res.rows[0];
}

/**
 * Runs batch classification over candidate documents.
 */
export async function classifyBatch(
  sourceId?: string,
  limit: number = 20,
  jobId?: string
): Promise<BatchClassificationSummary> {
  console.log(
    `[CLASSIFIER] Running batch classification (source: ${sourceId || "ALL"}, limit: ${limit})...`
  );

  let queryText = `
    SELECT d.id, d.source_id, s.name as source_name, d.canonical_url, d.title
    FROM documents d
    JOIN sources s ON d.source_id = s.id
    WHERE d.status IN ('CLASSIFIED_PENDING', 'EXTRACTED')
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
  console.log(`[CLASSIFIER] Found ${docs.length} documents eligible for classification.`);

  let twoPlusYearsCount = 0;
  let lessThanTwoYearsCount = 0;
  let needsReviewCount = 0;
  const results: DocumentClassificationResult[] = [];

  for (const doc of docs) {
    const classificationRecord = await classify(doc.id);

    if (classificationRecord.classification === "TWO_PLUS_YEARS") {
      twoPlusYearsCount++;
    } else if (classificationRecord.classification === "LESS_THAN_TWO_YEARS") {
      lessThanTwoYearsCount++;
    } else {
      needsReviewCount++;
    }

    results.push({
      documentId: doc.id,
      title: doc.title,
      canonicalUrl: doc.canonical_url,
      classification: classificationRecord.classification,
      completedYears: classificationRecord.completed_years
        ? Number(classificationRecord.completed_years)
        : null,
      durationText: classificationRecord.duration_text,
      confidence: Number(classificationRecord.confidence),
      reasoning: classificationRecord.reasoning,
    });

    if (jobId) {
      await saveCheckpoint(
        jobId,
        null,
        null,
        results.length,
        "RUNNING",
        "CLASSIFICATION"
      );
    }
  }

  if (jobId && docs.length > 0) {
    await saveCheckpoint(
      jobId,
      null,
      null,
      results.length,
      "COMPLETED",
      "CLASSIFICATION"
    );
  }

  return {
    totalProcessed: docs.length,
    twoPlusYearsCount,
    lessThanTwoYearsCount,
    needsReviewCount,
    results,
  };
}

/**
 * Retrieves the classification record for a given document.
 */
export async function getDocumentClassification(
  documentId: string
): Promise<ClassificationRow | null> {
  const res = await query<ClassificationRow>(
    `SELECT id, document_id, classification, completed_years, duration_text, 
            confidence, verification_status, model_used, reasoning, classified_at
     FROM classifications
     WHERE document_id = $1;`,
    [documentId]
  );
  return res.rows[0] || null;
}
