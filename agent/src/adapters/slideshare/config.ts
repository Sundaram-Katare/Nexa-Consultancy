/**
 * ============================================================================
 * SLIDESHARE ADAPTER CONFIGURATION
 * ============================================================================
 */

export const SLIDESHARE_CONFIG = {
  SOURCE_ID: "slideshare",
  BASE_URL: "https://www.slideshare.net",
  SEARCH_URL_TEMPLATE: "https://www.slideshare.net/search?searchFrom=header&q={query}&page={page}",
  
  // Rate limiting delay in milliseconds to respect server load and prevent 429 throttling
  MIN_REQUEST_DELAY_MS: 2500,

  // Navigation and DOM extraction timeouts
  NAVIGATION_TIMEOUT_MS: 30000,
  SELECTOR_TIMEOUT_MS: 10000,
} as const;
