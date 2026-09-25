export type ErrorCategory =
  | "NAVIGATION_TIMEOUT"
  | "ELEMENT_NOT_FOUND"
  | "LOGIN_REQUIRED"
  | "CAPTCHA_DETECTED"
  | "ACCESS_DENIED"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "EXTRACTION_ERROR"
  | "CLASSIFICATION_ERROR"
  | "DATABASE_ERROR";

export interface ErrorCategoryConfig {
  maxRetries: number;
  backoffBaseMs: number;
  pauseJobOnExhaustion: boolean;
  requiresHumanIntervention: boolean;
  description: string;
}

/**
 * Standard retry and intervention policy definition per error category,
 * conforming to Phase 0 architecture guidelines.
 */
export const ERROR_CATEGORIES: Record<ErrorCategory, ErrorCategoryConfig> = {
  NAVIGATION_TIMEOUT: {
    maxRetries: 3,
    backoffBaseMs: 2000,
    pauseJobOnExhaustion: false,
    requiresHumanIntervention: false,
    description: "Browser page navigation or network response timed out",
  },
  ELEMENT_NOT_FOUND: {
    maxRetries: 2,
    backoffBaseMs: 1000,
    pauseJobOnExhaustion: false,
    requiresHumanIntervention: false,
    description: "Required DOM selector or element was not located",
  },
  LOGIN_REQUIRED: {
    maxRetries: 0,
    backoffBaseMs: 0,
    pauseJobOnExhaustion: true,
    requiresHumanIntervention: true,
    description: "Site presented authentication wall; requires human credentials/login",
  },
  CAPTCHA_DETECTED: {
    maxRetries: 0,
    backoffBaseMs: 0,
    pauseJobOnExhaustion: true,
    requiresHumanIntervention: true,
    description: "Anti-bot challenge or CAPTCHA detected (Hard stop; zero automated retries per anti-bypass rule)",
  },
  ACCESS_DENIED: {
    maxRetries: 1,
    backoffBaseMs: 2000,
    pauseJobOnExhaustion: true,
    requiresHumanIntervention: true,
    description: "HTTP 403 Forbidden or IP-level blocking detected",
  },
  RATE_LIMITED: {
    maxRetries: 2,
    backoffBaseMs: 10000,
    pauseJobOnExhaustion: true,
    requiresHumanIntervention: false,
    description: "HTTP 429 Too Many Requests signal; requires global slowdown and pause",
  },
  SERVER_ERROR: {
    maxRetries: 3,
    backoffBaseMs: 2000,
    pauseJobOnExhaustion: false,
    requiresHumanIntervention: false,
    description: "Remote server returned HTTP 5xx or connection was unexpectedly reset",
  },
  EXTRACTION_ERROR: {
    maxRetries: 3,
    backoffBaseMs: 1000,
    pauseJobOnExhaustion: false,
    requiresHumanIntervention: false,
    description: "Failed to parse document DOM or extract metadata/transcript content",
  },
  CLASSIFICATION_ERROR: {
    maxRetries: 1,
    backoffBaseMs: 1000,
    pauseJobOnExhaustion: false,
    requiresHumanIntervention: false,
    description: "Failure evaluating duration patterns or applying classification rules",
  },
  DATABASE_ERROR: {
    maxRetries: 2,
    backoffBaseMs: 500,
    pauseJobOnExhaustion: true,
    requiresHumanIntervention: false,
    description: "Database connection or query failure",
  },
};
