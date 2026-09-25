# Scribd Manual Research Notes & Technical Investigation

This document details the DOM structure, network requests, session authentication model, and rate limiting parameters for the Scribd adapter.

---

### 1. Homepage & Architecture
- **Base URL**: `https://www.scribd.com`
- **Search URL Pattern**: `https://www.scribd.com/search?query={query}&page={page}` (or `https://www.scribd.com/search?content_type=documents&query={query}&page={page}`)
- **Public vs Authenticated Access**:
  - **Search & Result Listing**: Publicly accessible without mandatory login.
  - **Document Previews & Metadata**: Publicly accessible.
  - **Full Document Content / Downloads**: May require authenticated session or subscription cookies (`SCRIBD_USERNAME`, `SCRIBD_PASSWORD`, or session cookies `_scribd_session`).

---

### 2. Search URL & Query Parameters
- **Query Parameter**: `query` (URL-encoded search string, e.g. `query=Ghana+academic+transcript`)
- **Page Parameter**: `page` (1-indexed integer, e.g. `page=1`, `page=2`)
- **Content Type Filter**: `content_type=documents` to filter out podcasts/audiobooks and focus specifically on PDF/academic documents.

---

### 3. Result Card DOM Structure
- **Card Container Selectors**:
  - `div[data-e2e="search-result-cell"]`
  - `div[data-testid="search_result_item"]`
  - `div.document_cell`
  - `a.title_link[href*="/document/"]`
- **Document ID Extraction**:
  - URL format: `https://www.scribd.com/document/123456789/Document-Title` -> ID: `123456789`
- **Card Title Selectors**:
  - `a[data-e2e="doc-title"]`
  - `span[data-e2e="doc-title"]`
  - `a.title_link`
  - `h2.title, h3.title`
- **Card Metadata / Author / Snippet**:
  - `span.author` or `div[data-e2e="doc-author"]`
  - `p.description, div.description`

---

### 4. Pagination Behavior
- **Pagination Navigation**:
  - Next Page Button: `a[data-e2e="pagination-next"]`, `a.next_page`, `button[aria-label="Next page"]`
  - Page URL Query: Directly supports `page=N` parameter in query string.
- **End of Results Indicator**:
  - Presence of empty result message (`div.no_results`, `div[data-e2e="no-search-results"]`), or next button disabled/absent, or `0` result cards returned.

---

### 5. Document Page Structure & Evidence Blocks
- **Document Title**:
  - `h1[data-e2e="document-title"]`
  - `h1.doc_title`
  - `meta[property="og:title"]`
- **Document Description / Metadata**:
  - `div[data-e2e="document-description"]`
  - `p.description`
  - `meta[property="og:description"]`
- **Document Body & Text Content Extraction**:
  - Scribd renders pages inside a document reader container:
    - `div.document_scroller`
    - `div.text_layer`
    - `div.page_blur_container, div.newpage`
    - `div[data-testid="document-page"]`
  - Text extraction pulls all paragraph spans, text layers, and visible slide/page blocks into `document_evidence` rows.

---

### 6. Authentication & Session Management
- **Auth Endpoint / Flow**:
  - Login Page: `https://www.scribd.com/login`
  - Email/Username Field: `input[name="username"], input[name="login_or_email"], input[type="email"]`
  - Password Field: `input[name="password"], input[type="password"]`
  - Submit Button: `button[type="submit"], button[data-e2e="login-button"]`
- **Session Cache & Reuse**:
  - Authenticated cookies are cached across the `BrowserContext` so login only executes on initial session establishment or upon detecting a login wall.
  - Re-logging in before every document is explicitly avoided to prevent rate limiting and account lockout.
- **Failed Auth Handling**:
  - Categorized as `LOGIN_REQUIRED` or `ACCESS_DENIED`, safely pausing the job and alerting operators for human intervention rather than retrying in an infinite loop.

---

### 7. Rate Limiting & Access Policy
- **Minimum Request Delay**: `MIN_REQUEST_DELAY_MS: 3000` (tuned to be conservative with 3.0s between requests).
- **Robots.txt & Terms Compliance**:
  - Public search endpoints and document previews respected.
  - Automated crawling is throttled and polite, never bypassing anti-bot challenges without authorization.
