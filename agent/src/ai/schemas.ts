import { z } from "zod";

/**
 * Zod schema for Relevance Response from LLM
 */
export const RelevanceResponseSchema = z.object({
  relevant: z.boolean().describe("Whether this document is an academic transcript/record"),
  confidence: z.number().min(0).max(1).describe("Confidence score between 0.0 and 1.0"),
  reasoning: z.string().min(5).describe("Concise explanation citing specific evidence text"),
});

export type RelevanceResponse = z.infer<typeof RelevanceResponseSchema>;

/**
 * Zod schema for Classification Response from LLM
 */
export const ClassificationResponseSchema = z.object({
  classification: z.enum(["TWO_PLUS_YEARS", "LESS_THAN_TWO_YEARS", "NEEDS_REVIEW"]).describe(
    "Defensible classification result"
  ),
  completedYears: z.number().nullable().describe(
    "Estimated completed academic years (e.g. 2.0, 3.0, 4.0), or null if not established"
  ),
  reasoning: z.string().min(5).describe(
    "Defensible reasoning citing the exact duration evidence"
  ),
  confidence: z.number().min(0).max(1).describe("Confidence score between 0.0 and 1.0"),
});

export type ClassificationResponse = z.infer<typeof ClassificationResponseSchema>;

/**
 * Custom Error Types for Local AI / Ollama
 */
export class AiUnavailableError extends Error {
  constructor(message: string = "Ollama service is unreachable or timed out") {
    super(`[AI_UNAVAILABLE] ${message}`);
    this.name = "AiUnavailableError";
  }
}

export class AiInvalidResponseError extends Error {
  constructor(message: string = "Model output failed JSON schema validation after retry") {
    super(`[AI_INVALID_RESPONSE] ${message}`);
    this.name = "AiInvalidResponseError";
  }
}
