/**
 * ============================================================================
 * SCRIBD ADAPTER CONFIGURATION
 * ============================================================================
 */

export const SCRIBD_CONFIG = {
  SOURCE_ID: "scribd",
  BASE_URL: "https://www.scribd.com",
  SEARCH_URL_TEMPLATE:
    "https://www.scribd.com/search?content_type=documents&query={query}&page={page}",
  LOGIN_URL: "https://www.scribd.com/login",

  // Conservative rate limiting delay to respect server load and prevent throttling
  MIN_REQUEST_DELAY_MS: 3000,

  // Navigation and DOM extraction timeouts
  NAVIGATION_TIMEOUT_MS: 30000,
  SELECTOR_TIMEOUT_MS: 10000,
} as const;
