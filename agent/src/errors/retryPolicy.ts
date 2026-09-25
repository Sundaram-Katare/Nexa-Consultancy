import { ErrorCategory, ERROR_CATEGORIES, ErrorCategoryConfig } from "./errorCategories";
import { AdapterError } from "../adapters/baseAdapter";

export interface RetryPolicy extends ErrorCategoryConfig {
  category: ErrorCategory;
}

/**
 * Retrieves the defined RetryPolicy for a specific error category.
 */
export function getRetryPolicy(category: ErrorCategory): RetryPolicy {
  const config = ERROR_CATEGORIES[category] || ERROR_CATEGORIES.SERVER_ERROR;
  return {
    category,
    ...config,
  };
}

/**
 * Computes exponential backoff delay in milliseconds for a given attempt number.
 * Backoff formula: backoffBaseMs * 2^(attemptNumber)
 * For attempt 0 (first retry): base * 1
 * For attempt 1 (second retry): base * 2
 * For attempt 2 (third retry): base * 4
 */
export function calculateBackoffMs(policy: RetryPolicy, attemptNumber: number): number {
  if (policy.backoffBaseMs <= 0 || policy.maxRetries === 0) {
    return 0;
  }
  return policy.backoffBaseMs * Math.pow(2, attemptNumber);
}

/**
 * Maps arbitrary exceptions (Playwright errors, HTTP statuses, database errors, AdapterErrors)
 * into a typed ErrorCategory.
 */
export function mapErrorToCategory(
  err: any,
  fallback: ErrorCategory = "SERVER_ERROR"
): ErrorCategory {
  if (!err) return fallback;

  if (err instanceof AdapterError) {
    switch (err.category) {
      case "NAVIGATION_TIMEOUT":
        return "NAVIGATION_TIMEOUT";
      case "ELEMENT_NOT_FOUND":
        return "ELEMENT_NOT_FOUND";
      case "AUTH_REQUIRED":
        return "LOGIN_REQUIRED";
      case "BLOCKED_OR_CAPTCHA":
        return "CAPTCHA_DETECTED";
      case "RATE_LIMITED":
        return "RATE_LIMITED";
      case "EXTRACTION_ERROR":
      case "PARSING_ERROR":
        return "EXTRACTION_ERROR";
      default:
        break;
    }
  }

  const msg = (err.message || String(err)).toLowerCase();

  if (msg.includes("captcha") || msg.includes("cloudflare") || msg.includes("challenge") || msg.includes("robot")) {
    return "CAPTCHA_DETECTED";
  }
  if (msg.includes("login") || msg.includes("sign in") || msg.includes("auth_required") || msg.includes("unauthorized") || msg.includes("401")) {
    return "LOGIN_REQUIRED";
  }
  if (msg.includes("403") || msg.includes("forbidden") || msg.includes("access_denied") || msg.includes("blocked")) {
    return "ACCESS_DENIED";
  }
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("rate_limited")) {
    return "RATE_LIMITED";
  }
  if (msg.includes("timeout") || msg.includes("navigation timeout") || msg.includes("timed out") || msg.includes("navigation_timeout")) {
    return "NAVIGATION_TIMEOUT";
  }
  if (msg.includes("waiting for locator") || msg.includes("waiting for selector") || msg.includes("not found") || msg.includes("element_not_found")) {
    return "ELEMENT_NOT_FOUND";
  }
  if (msg.includes("extract") || msg.includes("metadata") || msg.includes("transcript") || msg.includes("content") || msg.includes("parse")) {
    return "EXTRACTION_ERROR";
  }
  if (msg.includes("classify") || msg.includes("classification") || msg.includes("signal")) {
    return "CLASSIFICATION_ERROR";
  }
  if (msg.includes("database") || msg.includes("relation") || msg.includes("syntax error") || msg.includes("pool") || msg.includes("query failed")) {
    return "DATABASE_ERROR";
  }

  return fallback;
}
