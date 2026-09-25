import { query } from "../db/pool";
import { getDocumentEvidence } from "../db/queries/documents";
import { deterministicRelevanceCheck, RelevanceVerdict } from "./keywordFilter";
import { saveCheckpoint } from "../pipeline/checkpointService";
import { ollamaClient } from "../ai/ollamaClient";
import { RelevanceResponseSchema } from "../ai/schemas";
import { buildRelevancePrompt } from "../ai/prompts/relevancePrompt";

export interface DocumentRelevanceResult {
  id: string;
  title: string | null;
  canonicalUrl: string;
  status: "CLASSIFIED_PENDING" | "IRRELEVANT" | "NEEDS_RELEVANCE_REVIEW";
  verdict: RelevanceVerdict;
  confidence: number;
  reason: string;
}

export interface RelevanceFilterSummary {
  totalProcessed: number;
  relevantCount: number;
  irrelevantCount: number;
  ambiguousCount: number;
  results: DocumentRelevanceResult[];
}

/**
 * Runs deterministic relevance detection on all EXTRACTED documents,
 * moving them into CLASSIFIED_PENDING, IRRELEVANT, or NEEDS_RELEVANCE_REVIEW.
 */
export async function runRelevanceFilter(
  sourceId?: string,
  limit: number = 20,
  jobId?: string
): Promise<RelevanceFilterSummary> {
  console.log(
    `[RELEVANCE_FILTER] Running relevance filter (source: ${sourceId || "ALL"}, limit: ${limit})...`
  );

  // 1. Query EXTRACTED documents
  let queryText = `
    SELECT d.id, d.source_id, s.name as source_name, d.canonical_url, d.title, d.raw_metadata
    FROM documents d
    JOIN sources s ON d.source_id = s.id
    WHERE d.status = 'EXTRACTED'
  `;
  const params: any[] = [];

  if (sourceId) {
    params.push(sourceId.toLowerCase());
    queryText += ` AND (LOWER(s.name) = $1 OR s.id::text = $1) `;
  }

  params.push(limit);
  queryText += ` ORDER BY d.created_at ASC LIMIT $${params.length};`;

  const docsRes = await query<{
    id: string;
    source_id: number;
    source_name: string;
    canonical_url: string;
    title: string | null;
    raw_metadata: any;
  }>(queryText, params);

  const docs = docsRes.rows;
  console.log(`[RELEVANCE_FILTER] Found ${docs.length} EXTRACTED documents to evaluate.`);

  if (docs.length === 0) {
    return {
      totalProcessed: 0,
      relevantCount: 0,
      irrelevantCount: 0,
      ambiguousCount: 0,
      results: [],
    };
  }

  let relevantCount = 0;
  let irrelevantCount = 0;
  let ambiguousCount = 0;
  const results: DocumentRelevanceResult[] = [];

  // 2. Evaluate each document against deterministic rules
  for (const doc of docs) {
    const evidenceRows = await getDocumentEvidence(doc.id);
    const evidenceTexts = evidenceRows.map((e) => e.evidence_text);

    const check = deterministicRelevanceCheck(doc.title || "", evidenceTexts);

    let verdict: RelevanceVerdict = check.verdict;
    let confidence = check.confidence;
    let reason = check.reason;
    let isAiAssisted = false;
    let modelUsed: string | null = null;
    let newStatus: "CLASSIFIED_PENDING" | "IRRELEVANT" | "NEEDS_RELEVANCE_REVIEW";

    if (check.verdict === "RELEVANT") {
      newStatus = "CLASSIFIED_PENDING";
      relevantCount++;
    } else if (check.verdict === "NOT_RELEVANT") {
      newStatus = "IRRELEVANT";
      irrelevantCount++;
    } else {
      // AMBIGUOUS - Call Local AI via Ollama
      console.log(`[RELEVANCE_FILTER] AMBIGUOUS case for doc ${doc.id} ("${doc.title}"). Invoking Ollama AI...`);
      try {
        const { system, prompt } = buildRelevancePrompt(doc.title || "", evidenceTexts);
        const aiRes = await ollamaClient.generate(prompt, RelevanceResponseSchema, system);

        isAiAssisted = true;
        modelUsed = process.env.OLLAMA_MODEL || "qwen2.5:3b";
        confidence = aiRes.confidence;
        reason = `[AI-Assisted]: ${aiRes.reasoning}`;

        if (aiRes.relevant && aiRes.confidence >= 0.6) {
          verdict = "RELEVANT";
          newStatus = "CLASSIFIED_PENDING";
          relevantCount++;
        } else {
          verdict = "NOT_RELEVANT";
          newStatus = "IRRELEVANT";
          irrelevantCount++;
        }
        console.log(`[RELEVANCE_FILTER] ✅ AI verdict for doc ${doc.id}: ${verdict} (Confidence: ${confidence})`);
      } catch (err: any) {
        console.warn(
          `[RELEVANCE_FILTER] ⚠️ Local AI unavailable or invalid response (${err.message}). Safely falling back to NEEDS_RELEVANCE_REVIEW.`
        );
        newStatus = "NEEDS_RELEVANCE_REVIEW";
        verdict = "AMBIGUOUS";
        reason = `${check.reason} (AI evaluation skipped/fallback: ${err.name})`;
        ambiguousCount++;
      }
    }

    // 3. Update document status and store relevance explanation in raw_metadata
    const relevanceMetadata = {
      verdict,
      confidence,
      reason,
      matchedPositiveTerms: check.matchedPositiveTerms,
      matchedExclusionTerms: check.matchedExclusionTerms,
      ai_assisted: isAiAssisted,
      model_used: modelUsed,
      evaluatedAt: new Date().toISOString(),
    };

    await query(
      `UPDATE documents 
       SET status = $2,
           raw_metadata = jsonb_set(
             COALESCE(raw_metadata, '{}'::jsonb),
             '{relevance}',
             $3::jsonb
           )
       WHERE id = $1;`,
      [doc.id, newStatus, JSON.stringify(relevanceMetadata)]
    );

    console.log(
      `[RELEVANCE_FILTER] Doc ${doc.id} ("${doc.title}") -> [${verdict}] -> status=${newStatus} (${reason})`
    );

    results.push({
      id: doc.id,
      title: doc.title,
      canonicalUrl: doc.canonical_url,
      status: newStatus,
      verdict,
      confidence,
      reason,
    });

    if (jobId) {
      await saveCheckpoint(
        jobId,
        null,
        null,
        results.length,
        "RUNNING",
        "RELEVANCE_FILTER"
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
      "RELEVANCE_FILTER"
    );
  }

  console.log(
    `[RELEVANCE_FILTER] Completed: ${relevantCount} RELEVANT, ${irrelevantCount} IRRELEVANT, ${ambiguousCount} AMBIGUOUS out of ${docs.length} total.`
  );

  return {
    totalProcessed: docs.length,
    relevantCount,
    irrelevantCount,
    ambiguousCount,
    results,
  };
}

/**
 * Retrieves all documents currently waiting in the NEEDS_RELEVANCE_REVIEW queue.
 */
export async function getDocumentsNeedingRelevanceReview() {
  const res = await query(
    `SELECT 
       d.id, d.source_id, s.name as source_name, d.canonical_url, d.title,
       d.country_id, c.name as country_name, d.institution, d.status,
       d.raw_metadata->'relevance' as relevance_details,
       d.created_at
     FROM documents d
     JOIN sources s ON d.source_id = s.id
     LEFT JOIN countries c ON d.country_id = c.id
     WHERE d.status = 'NEEDS_RELEVANCE_REVIEW'
     ORDER BY d.created_at DESC;`
  );
  return res.rows;
}
