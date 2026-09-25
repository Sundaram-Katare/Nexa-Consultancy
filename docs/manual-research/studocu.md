# StuDocu (studocu) Manual Research & Technical Investigation

This document details the DOM structure, URL schemas, query parameters, text extraction layers, and rate limiting parameters for the `studocu` adapter.

---

### 1. Homepage & Architecture
- **Base URL**: `https://www.studocu.com`
- **Search URL Pattern**: `https://www.studocu.com/en/search?q={query}&page={page}` (or `https://www.studocu.com/en/document/{institution}/{course}/{title}/{id}`)
- **Public vs Authenticated Access**:
  - **Search & Preview Cards**: Openly accessible without authentication.
  - **Document Previews & Text Samples**: Publicly accessible via sample render layers.

---

### 2. Search URL & Query Parameters
- **Query Parameter**: `q` (URL-encoded search string, e.g. `q=Ghana+University+academic+transcript+exam`)
- **Page Parameter**: `page` (1-indexed integer, e.g. `page=1`, `page=2`)
- **Example URL**: `https://www.studocu.com/en/search?q=academic%20transcript&page=1`

---

### 3. Result Card DOM Structure
- **Card Container Selectors**:
  - `div[data-testid="search-result-item"]`
  - `div.search-result-card`
  - `a[href*="/document/"]`
  - `div.document-card`
  - `li[data-testid="document-item"]`
- **Document ID Extraction**:
  - Extracted from document URL (digits trailing the URL path, e.g. `/document/.../12345678`).
  - Example: `https://www.studocu.com/en/document/university-of-toronto/curriculum/academic-record/9876543` -> ID: `9876543`
- **Card Title Selectors**:
  - `h3`
  - `span[data-testid="document-title"]`
  - `a[data-testid="document-link"]`
  - `div.title`
- **Card Metadata / School / Course / Pages**:
  - `span[data-testid="institution-name"]`
  - `span[data-testid="course-name"]`
  - `div.document-metadata`

---

### 4. Pagination Behavior
- **Pagination Controls**:
  - Next Page Button: `button[data-testid="pagination-next"]`, `a[aria-label="Next page"]`, `a.pagination-next`
  - Direct URL Pagination: `page={page}` parameter.
- **End of Results Indicator**:
  - Empty search container (`div[data-testid="empty-search-state"]`, `div.no-results`), or 0 document cards returned.

---

### 5. Document Page Structure & Evidence Blocks
- **Canonical URL**: `https://www.studocu.com/en/document/{institution}/{course}/{title}/{id}`
- **Document Title**:
  - `h1[data-testid="document-title"]`
  - `h1.document-title`
  - `h1`
  - `meta[property="og:title"]`
- **Institution & Course**:
  - `a[data-testid="institution-link"]`
  - `a[data-testid="course-link"]`
  - `span.institution-title`
- **Document Body & Content Blocks**:
  - `div[data-testid="document-viewer"] p`
  - `div.page-content p`
  - `div.page-wrapper span`
  - `div.document-page`
  - `article p`

---

### 6. Login Wall & Bot Rules
- **Public Preview Browsing**: Public preview enabled for search indexing.
- **Rate Limiting Delay**: `MIN_REQUEST_DELAY_MS: 3000` (conservative 3.0s delay).

---

### 7. Rate Limiting Signals
- Throttled delay between requests, standard 200 OK handling, exponential backoff on 429.
