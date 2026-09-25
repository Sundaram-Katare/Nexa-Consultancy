import { query } from "../db/pool";
import { updateJobStatus } from "../db/queries/jobs";
import { ErrorCategory } from "./errorCategories";
import {
  RetryPolicy,
  getRetryPolicy,
  calculateBackoffMs,
  mapErrorToCategory,
} from "./retryPolicy";

export interface RetryContext {
  jobId?: string;
  searchTaskId?: string;
  documentId?: string;
  action?: string;
  details?: Record<string, any>;
}

export class PipelineExecutionError extends Error {
  public readonly category: ErrorCategory;
  public readonly attempts: number;
  public readonly requiresHumanIntervention: boolean;
  public readonly pausedJob: boolean;
  public readonly originalError?: Error;
  public readonly context?: RetryContext;

  constructor(
    message: string,
    category: ErrorCategory,
    attempts: number,
    requiresHumanIntervention: boolean,
    pausedJob: boolean,
    originalError?: Error,
    context?: RetryContext
  ) {
    super(message);
    this.name = "PipelineExecutionError";
    this.category = category;
    this.attempts = attempts;
    this.requiresHumanIntervention = requiresHumanIntervention;
    this.pausedJob = pausedJob;
    this.originalError = originalError;
    this.context = context;
  }
}

/**
 * Unified retry wrapper providing deterministic exponential backoff, PostgreSQL error logging,
 * automatic job blocking on critical exhaustion, and human intervention signaling.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  expectedCategory: ErrorCategory = "SERVER_ERROR",
  context: RetryContext = {}
): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (rawError: any) {
      const activeCategory: ErrorCategory = mapErrorToCategory(
        rawError,
        expectedCategory
      );
      const policy: RetryPolicy = getRetryPolicy(activeCategory);

      const errorMessage = rawError?.message || String(rawError);
      const formattedMessage = policy.requiresHumanIntervention
        ? `[HUMAN_INTERVENTION_REQUIRED] [${activeCategory}] ${context.action ? `[${context.action}] ` : ""}${errorMessage}`
        : `[${activeCategory}] ${context.action ? `[${context.action}] ` : ""}${errorMessage}`;

      console.warn(
        `[RETRY_WRAPPER] Failure on attempt ${attempt + 1}/${policy.maxRetries + 1} (${activeCategory}): ${errorMessage}`
      );

      // 1. Record error row into database
      try {
        await query(
          `INSERT INTO errors (
             job_id, search_task_id, document_id, error_category, 
             message, retry_count, occurred_at, requires_human_intervention, details
           ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8);`,
          [
            context.jobId || null,
            context.searchTaskId || null,
            context.documentId || null,
            activeCategory,
            formattedMessage,
            attempt,
            policy.requiresHumanIntervention,
            context.details ? JSON.stringify(context.details) : null,
          ]
        );
      } catch (dbErr: any) {
        console.error(`[RETRY_WRAPPER] Failed to write error log to DB: ${dbErr.message}`);
      }

      // 2. Check if retries are remaining
      if (attempt < policy.maxRetries) {
        const backoffMs = calculateBackoffMs(policy, attempt);
        console.log(
          `[RETRY_WRAPPER] Retrying in ${backoffMs}ms (Attempt ${attempt + 1} of ${policy.maxRetries})...`
        );
        attempt++;
        if (backoffMs > 0) {
          await new Promise((res) => setTimeout(res, backoffMs));
        }
      } else {
        // Retries exhausted
        let pausedJob = false;
        if (policy.pauseJobOnExhaustion && context.jobId) {
          try {
            await updateJobStatus(context.jobId, "BLOCKED");
            pausedJob = true;
            console.warn(
              `[RETRY_WRAPPER] 🛑 Job ${context.jobId} status transitioned to 'BLOCKED' following ${activeCategory} exhaustion.`
            );
          } catch (pauseErr: any) {
            console.error(`[RETRY_WRAPPER] Failed to set job status to BLOCKED: ${pauseErr.message}`);
          }
        }

        throw new PipelineExecutionError(
          formattedMessage,
          activeCategory,
          attempt + 1,
          policy.requiresHumanIntervention,
          pausedJob,
          rawError instanceof Error ? rawError : undefined,
          context
        );
      }
    }
  }
}
