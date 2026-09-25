/**
 * ============================================================================
 * ZENODO (zenodo_core) DOM SELECTORS
 * ============================================================================
 */

export const ZENODO_SELECTORS = {
  SEARCH: {
    RESULT_CARDS: [
      "div.item",
      'div[data-testid="search-result-item"]',
      "div.search-result-item",
      "li.search-result",
      "div.ui.items > div.item",
      'div[class*="SearchResultItem"]',
    ].join(", "),

    TITLE: [
      "h4.header a",
      "a.title",
      "div.header a",
      "h3.header",
      "h4.header",
      'a[href*="/records/"]',
    ].join(", "),

    LINK: [
      'a[href*="/records/"]',
      "h4.header a",
      "a.title",
    ].join(", "),

    DESCRIPTION: [
      "div.description",
      "div.extra",
      "p",
    ].join(", "),

    PAGINATION_NEXT: [
      'a[aria-label="Next"]',
      'a.item[rel="next"]',
      'li.page-item a[aria-label="Next"]',
      "a.next",
      'a[data-testid="pagination-next"]',
    ].join(", "),

    NO_RESULTS: [
      "div.no-results",
      "div.ui.placeholder.segment",
      'div:has-text("No records found")',
      'p:has-text("No records")',
    ].join(", "),
  },

  DOCUMENT: {
    TITLE: [
      "h1#record-title",
      "h1.record-title",
      "h1.header",
      'meta[name="citation_title"]',
      "h1",
    ].join(", "),

    DESCRIPTION: [
      "div#record-description",
      "div.record-description",
      "div.abstract",
      'meta[name="description"]',
      "div.description",
    ].join(", "),

    CREATOR: [
      "section#record-creators li",
      "span.creator-name",
      "span.creator-affiliation",
      'meta[name="citation_author"]',
      "span.author",
    ].join(", "),

    DATE: [
      "span#record-published-date",
      'meta[name="citation_publication_date"]',
      "span.date",
    ].join(", "),

    TEXT_BLOCKS: [
      "div#record-description p",
      "div.record-description",
      "table.table td",
      "div.ui.segment p",
      "div.abstract p",
      "main p",
    ].join(", "),

    FALLBACK_CONTAINER: [
      "div#record-description",
      "div.record-description",
      "div.ui.container",
      "main",
    ].join(", "),
  },
} as const;
