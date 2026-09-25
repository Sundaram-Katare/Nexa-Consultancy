/**
 * ============================================================================
 * STUDOCU (studocu) DOM SELECTORS
 * ============================================================================
 */

export const STUDOCU_SELECTORS = {
  SEARCH: {
    RESULT_CARDS: [
      'div[data-testid="search-result-item"]',
      "div.search-result-card",
      'a[href*="/document/"]',
      "div.document-card",
      'li[data-testid="document-item"]',
      'div[class*="DocumentCard"]',
    ].join(", "),

    TITLE: [
      "h3",
      'span[data-testid="document-title"]',
      'a[data-testid="document-link"]',
      "div.title",
      "h4",
      'a[href*="/document/"]',
    ].join(", "),

    LINK: [
      'a[href*="/document/"]',
      'a[data-testid="document-link"]',
    ].join(", "),

    INSTITUTION: [
      'span[data-testid="institution-name"]',
      "span.institution-title",
      "div.institution",
    ].join(", "),

    DESCRIPTION: [
      "p.description",
      "div.snippet",
      "div.document-metadata",
      "p",
    ].join(", "),

    PAGINATION_NEXT: [
      'button[data-testid="pagination-next"]',
      'a[aria-label="Next page"]',
      "a.pagination-next",
      'a[rel="next"]',
      "a.next",
    ].join(", "),

    NO_RESULTS: [
      'div[data-testid="empty-search-state"]',
      "div.no-results",
      'div:has-text("No results found")',
      'p:has-text("No results")',
    ].join(", "),
  },

  DOCUMENT: {
    TITLE: [
      'h1[data-testid="document-title"]',
      "h1.document-title",
      "h1",
      'meta[property="og:title"]',
    ].join(", "),

    DESCRIPTION: [
      'div[data-testid="document-description"]',
      "p.description",
      'meta[property="og:description"]',
      "div.description",
    ].join(", "),

    INSTITUTION: [
      'a[data-testid="institution-link"]',
      'span[data-testid="institution-title"]',
      "span.institution-title",
      "a.institution",
    ].join(", "),

    COURSE: [
      'a[data-testid="course-link"]',
      'span[data-testid="course-title"]',
      "span.course-title",
    ].join(", "),

    DATE: [
      'span[data-testid="academic-year"]',
      "span.academic-year",
      "time",
    ].join(", "),

    TEXT_BLOCKS: [
      'div[data-testid="document-viewer"] p',
      "div.page-content p",
      "div.page-wrapper span",
      "div.document-page p",
      "article p",
      "div.preview-container p",
    ].join(", "),

    FALLBACK_CONTAINER: [
      'div[data-testid="document-viewer"]',
      "div.page-content",
      "div.document-page",
      "main",
    ].join(", "),
  },
} as const;
