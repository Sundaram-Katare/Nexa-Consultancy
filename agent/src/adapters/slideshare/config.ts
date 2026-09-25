/**
 * ============================================================================
 * SLIDESHARE ADAPTER CONFIGURATION
 * ============================================================================
 */

export const SLIDESHARE_CONFIG = {
  SOURCE_ID: "slideshare",
  BASE_URL: "https://www.slideshare.net",
  SEARCH_URL_TEMPLATE: "https://www.slideshare.net/search?searchFrom=header&q={query}&page={page}",
  
  // Fast request delay in milliseconds
  MIN_REQUEST_DELAY_MS: 200,

  // Navigation and DOM extraction timeouts
  NAVIGATION_TIMEOUT_MS: 30000,
  SELECTOR_TIMEOUT_MS: 10000,
} as const;
