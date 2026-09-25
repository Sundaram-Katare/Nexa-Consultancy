/**
 * ============================================================================
 * SCRIBD DOM SELECTORS
 * ============================================================================
 */

export const SCRIBD_SELECTORS = {
  // Search page result cards
  SEARCH: {
    // Top-level containers for search result items
    RESULT_CARDS: [
      'div[data-e2e="search-result-cell"]',
      'div[data-testid="search_result_item"]',
      "div.document_cell",
      'a.title_link[href*="/document/"]',
      'a[href*="scribd.com/document/"]',
      'div[class*="SearchResult"]',
    ].join(", "),

    // Title element within a result card
    TITLE: [
      'a[data-e2e="doc-title"]',
      'span[data-e2e="doc-title"]',
      "a.title_link",
      "h2.title",
      "h3.title",
      'span[class*="Title"]',
      "a[href*='/document/']",
    ].join(", "),

    // Link element to full document
    LINK: [
      'a[data-e2e="doc-title"]',
      "a.title_link",
      'a[href*="/document/"]',
    ].join(", "),

    // Snippet or author
    AUTHOR: [
      'span[data-e2e="doc-author"]',
      "span.author",
      'div[class*="Author"]',
    ].join(", "),

    DESCRIPTION: [
      'div[data-e2e="document-description"]',
      "p.description",
      'div[class*="Description"]',
    ].join(", "),

    // Pagination controls
    PAGINATION_NEXT: [
      'a[data-e2e="pagination-next"]',
      "a.next_page",
      'button[aria-label="Next page"]',
      'a[rel="next"]',
    ].join(", "),

    NO_RESULTS: [
      'div[data-e2e="no-search-results"]',
      "div.no_results",
      'p:has-text("No results found")',
      'div:has-text("No results found for")',
    ].join(", "),
  },

  // Document page selectors
  DOCUMENT: {
    TITLE: [
      'h1[data-e2e="document-title"]',
      "h1.doc_title",
      'h1[class*="DocumentTitle"]',
      "h1",
    ].join(", "),

    DESCRIPTION: [
      'div[data-e2e="document-description"]',
      "p.description",
      'div[class*="Description"]',
      'meta[property="og:description"]',
    ].join(", "),

    AUTHOR: [
      'a[data-e2e="author-name"]',
      'span[data-e2e="author-name"]',
      "a.author",
      'span[class*="Author"]',
    ].join(", "),

    UPLOAD_DATE: [
      'span[data-e2e="upload-date"]',
      "span.upload_date",
      'time',
    ].join(", "),

    // Document reader pages & text content
    TEXT_BLOCKS: [
      "div.text_layer p",
      "div.text_layer span",
      "div.document_scroller p",
      "div.newpage p",
      'div[data-testid="document-page"] p',
      'div[class*="PageText"]',
      "div.page_blur_container p",
      "article p",
    ].join(", "),

    FALLBACK_CONTAINER: [
      "div.document_scroller",
      "div.text_layer",
      "div.main_content",
      "article",
    ].join(", "),

    LOGIN_MODAL: [
      'div[data-e2e="login-modal"]',
      "div.login_gate",
      'div:has-text("Sign in to read")',
    ].join(", "),
  },

  // Authentication selectors
  AUTH: {
    EMAIL_INPUT: [
      'input[name="username"]',
      'input[name="login_or_email"]',
      'input[type="email"]',
      'input[id*="login"]',
    ].join(", "),

    PASSWORD_INPUT: [
      'input[name="password"]',
      'input[type="password"]',
      'input[id*="password"]',
    ].join(", "),

    SUBMIT_BUTTON: [
      'button[type="submit"]',
      'button[data-e2e="login-button"]',
      'button:has-text("Sign In")',
      'button:has-text("Log In")',
    ].join(", "),

    USER_AVATAR: [
      'div[data-e2e="user-menu"]',
      'img[data-e2e="user-avatar"]',
      "a.user_menu",
    ].join(", "),
  },
} as const;
