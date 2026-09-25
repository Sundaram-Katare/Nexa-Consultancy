/**
 * ============================================================================
 * ZENODO (zenodo_core) ADAPTER CONFIGURATION
 * ============================================================================
 */

export const ZENODO_CONFIG = {
  SOURCE_ID: "zenodo_core",
  BASE_URL: "https://zenodo.org",
  SEARCH_URL_TEMPLATE:
    "https://zenodo.org/records?q={query}&page={page}",

  // Open-access CERN/OpenAIRE polite request delay
  MIN_REQUEST_DELAY_MS: 1500,

  NAVIGATION_TIMEOUT_MS: 30000,
  SELECTOR_TIMEOUT_MS: 10000,
} as const;
