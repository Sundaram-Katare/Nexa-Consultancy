/**
 * ============================================================================
 * INTERNET ARCHIVE (archive_org) DOM SELECTORS
 * ============================================================================
 */

export const ARCHIVE_ORG_SELECTORS = {
  SEARCH: {
    RESULT_CARDS: [
      "div.item-ia",
      "div.tile-ia",
      "div[data-id]",
      "div.result-item",
      "div.item-preview",
      'div.C234 a.item-title',
    ].join(", "),

    TITLE: [
      "div.ttl",
      "h3",
      "a.item-title",
      "div.item-ttl",
      "span.title",
      "div.tile-title",
    ].join(", "),

    LINK: [
      'a[href*="/details/"]',
      "a.item-title",
      "a.ttl",
    ].join(", "),

    DESCRIPTION: [
      "div.description",
      "div.item-description",
      "div.item-body",
      "p",
    ].join(", "),

    PAGINATION_NEXT: [
      "a.pagination-next",
      "a.next-page",
      'a[rel="next"]',
      "li.page-next a",
      "a.next",
    ].join(", "),

    NO_RESULTS: [
      "div.no-results",
      "div.empty-search",
      'div:has-text("No results found")',
      'p:has-text("No results")',
    ].join(", "),
  },

  DOCUMENT: {
    TITLE: [
      "h1.item-title",
      "h1.work-title",
      'h1[itemprop="name"]',
      "h1.metadata-field-title",
      "h1",
    ].join(", "),

    DESCRIPTION: [
      "div.item-description",
      "div#descript",
      "div.metadata-definition",
      'div[itemprop="description"]',
      "div.item-details-metadata",
    ].join(", "),

    CREATOR: [
      'span[itemprop="creator"]',
      "a.metadata-creator",
      "div.by a",
      "span.by",
    ].join(", "),

    DATE: [
      'span[itemprop="datePublished"]',
      "span.date",
      "div.metadata-field-date",
    ].join(", "),

    TEXT_BLOCKS: [
      "div.text-container p",
      "div#theatre-ia div.article-body p",
      "div.item-details-metadata p",
      "pre.ocr-text",
      "div.metadata-field",
      "div.article-body",
      "section.article-content p",
    ].join(", "),

    FALLBACK_CONTAINER: [
      "div.text-container",
      "div.article-body",
      "div.item-details-metadata",
      "main",
    ].join(", "),
  },
} as const;
