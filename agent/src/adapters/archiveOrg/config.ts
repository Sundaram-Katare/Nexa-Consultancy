/**
 * ============================================================================
 * INTERNET ARCHIVE (archive_org) ADAPTER CONFIGURATION
 * ============================================================================
 */

export const ARCHIVE_ORG_CONFIG = {
  SOURCE_ID: "archive_org",
  BASE_URL: "https://archive.org",
  SEARCH_URL_TEMPLATE:
    "https://archive.org/search.php?query={query}&page={page}",
  
  // Polite request delay for Internet Archive public infrastructure
  MIN_REQUEST_DELAY_MS: 2000,

  NAVIGATION_TIMEOUT_MS: 30000,
  SELECTOR_TIMEOUT_MS: 10000,
} as const;
