/**
 * ============================================================================
 * STUDOCU (studocu) ADAPTER CONFIGURATION
 * ============================================================================
 */

export const STUDOCU_CONFIG = {
  SOURCE_ID: "studocu",
  BASE_URL: "https://www.studocu.com",
  SEARCH_URL_TEMPLATE:
    "https://www.studocu.com/en/search?q={query}&page={page}",

  // Conservative rate limiting delay for StuDocu preview browsing
  MIN_REQUEST_DELAY_MS: 3000,

  NAVIGATION_TIMEOUT_MS: 30000,
  SELECTOR_TIMEOUT_MS: 10000,
} as const;
