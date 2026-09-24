/**
 * Thin interface for local LLM transcript relevance classification (Phase 20 Ollama integration).
 * Intentionally stubbed in Phase 11 per architectural instructions.
 */

export interface LLMRelevanceResult {
  relevant: boolean;
  confidence: number;
  reasoning: string;
}

/**
 * Classifies document relevance via local Ollama LLM.
 * Stubbed in Phase 11. Ambiguous documents route directly to 'NEEDS_RELEVANCE_REVIEW'.
 */
export async function classifyRelevance(
  title: string,
  evidenceTexts: string[] = []
): Promise<LLMRelevanceResult> {
  throw new Error(
    "NOT_IMPLEMENTED: Local LLM classification via Ollama is scheduled for Phase 20. Ambiguous documents should route to 'NEEDS_RELEVANCE_REVIEW'."
  );
}
