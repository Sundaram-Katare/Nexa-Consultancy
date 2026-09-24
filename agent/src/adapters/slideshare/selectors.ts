/**
 * ============================================================================
 * SLIDESHARE DOM SELECTORS
 * ============================================================================
 * Sourced directly from /docs/manual-research/slideshare.md.
 * ============================================================================
 */

export const SLIDESHARE_SELECTORS = {
  // Homepage & Header Search Input
  // Sourced from: <input type="text" autocomplete="off" aria-label="Search Slideshare" id="nav-search-query" data-cy="search-field" placeholder="Search" name="q" value="">
  SEARCH_INPUT: 'input#nav-search-query, input[data-cy="search-field"], input[name="q"]',

  // Result Cards on Search Page
  // Sourced from: <a class="SlideshowCardLink-module__vAXFxW__root" data-cy="slideshow-card-link" data-testid="slideshow-card-link" ...>
  RESULT_CARD: 'a[data-cy="slideshow-card-link"], a[data-testid="slideshow-card-link"], a[class*="SlideshowCardLink"]',

  // Result Title Link
  RESULT_TITLE_LINK: 'a[data-cy="slideshow-card-link"], a[data-testid="slideshow-card-link"]',

  // Result Title Text inside Card
  RESULT_TITLE_TEXT: 'h3, [class*="title"], [class*="Title"], [data-cy="slideshow-title"]',

  // Result Uploader in Card
  // Note: SlideShare cards embed uploader in the aria-label ("... by {uploader}, has X slides ...")
  // and secondary author links:
  RESULT_UPLOADER: '[class*="author"], [data-cy="author-name"], [data-testid="author-name"]',

  // Pagination Next Button / Link
  // Sourced from standard Next.js pagination bar on SlideShare search
  PAGINATION_NEXT: 'a[aria-label="Next page"], a[rel="next"], a[data-cy="pagination-next"], button[data-cy="load-more"]',

  // Document View: Title
  DOC_TITLE: 'h1[data-cy="slideshow-title"], h1, [data-testid="slideshow-title"], meta[property="og:title"]',

  // Document View: Description
  DOC_DESCRIPTION: '[data-cy="slideshow-description"], [class*="description"], p[class*="Description"], meta[name="description"], meta[property="og:description"]',

  // Document View: Uploader / Author
  DOC_UPLOADER: '[data-cy="user-name"], [data-testid="user-profile-link"], a[class*="author"], [class*="Author"]',

  // Document View: Upload Date
  DOC_UPLOAD_DATE: 'time, [data-cy="upload-date"], meta[itemprop="datePublished"]',

  // Document View: Transcript / Slide Text Content Blocks
  // Sourced from the transcript drawer / slide content sections
  DOC_CONTENT_BLOCK: '[data-cy="transcript-section"], [class*="transcript"], [class*="Transcript"], section[class*="transcript"], [data-testid="slide-text"], div[class*="slide-text"]',

  // Next.js State Data Tag
  NEXT_DATA_SCRIPT: 'script#__NEXT_DATA__',

  // No Results Marker
  NO_RESULTS: '[data-cy="no-results"], [class*="no-results"], [class*="NoResults"], .no-results',
} as const;
