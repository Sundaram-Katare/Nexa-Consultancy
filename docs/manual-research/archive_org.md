# Internet Archive (archive_org) Manual Research & Technical Investigation

This document details the DOM structure, URL schemas, query parameters, text extraction layers, and rate limiting parameters for the `archive_org` adapter.

---

### 1. Homepage & Architecture
- **Base URL**: `https://archive.org`
- **Search URL Pattern**: `https://archive.org/search.php?query={query}&page={page}` (or `https://archive.org/details/{id}`)
- **Public vs Authenticated Access**:
  - **Search & Details Pages**: 100% publicly accessible without login or session token.
  - **Full Document Content / Scans / OCR**: Completely free open access under public library exception.

---

### 2. Search URL & Query Parameters
- **Query Parameter**: `query` (URL-encoded search string, e.g. `query=Ghana+academic+transcript+records`)
- **Page Parameter**: `page` (1-indexed integer, e.g. `page=1`, `page=2`)
- **MediaType Filtering**: Can target `mediatype:texts` or general search.
- **Example URL**: `https://archive.org/search.php?query=academic%20transcript%20Canada&page=1`

---

### 3. Result Card DOM Structure
- **Card Container Selectors**:
  - `div.item-ia`
  - `div.tile-ia`
  - `div[data-id]`
  - `div.result-item`
  - `div.item-preview`
- **Document ID Extraction**:
  - Extracted from `data-id` attribute or URL path `/details/{identifier}`.
  - Example: `https://archive.org/details/universitytranscript1985` -> ID: `universitytranscript1985`
- **Card Title Selectors**:
  - `div.item-ia .ttl`
  - `div.item-ia h3`
  - `a.item-title`
  - `div[data-id] .item-ttl`
- **Card Metadata / Uploader / Date**:
  - `div.item-ia .by`
  - `div.item-ia .date`
  - `div.item-ia .description`

---

### 4. Pagination Behavior
- **Pagination Controls**:
  - Next Page Link: `a.pagination-next`, `a.next-page`, `a[rel="next"]`, `li.page-next a`
  - Direct URL Pagination: `page={page}` parameter is deterministically supported.
- **End of Results Indicator**:
  - Empty search container (`div.no-results`, `div.empty-search`), or 0 `.item-ia` cards rendered.

---

### 5. Document Page Structure & Evidence Blocks
- **Canonical URL**: `https://archive.org/details/{id}`
- **Document Title**:
  - `h1.item-title`
  - `h1.work-title`
  - `h1[itemprop="name"]`
  - `meta[property="og:title"]`
- **Document Description & Metadata**:
  - `div.item-description`
  - `div#descript`
  - `div.metadata-definition`
  - `dl.metadata-definition dd`
  - `span[itemprop="creator"]`
  - `span[itemprop="datePublished"]`
- **Document Body & OCR Text Layers**:
  - Archive.org displays full document text / OCR transcript in:
    - `div.text-container`
    - `div#theatre-ia div.article-body`
    - `div.item-details-metadata`
    - `pre.ocr-text`
    - `div.metadata-field`

---

### 6. Login Wall & Bot Rules
- **No Login Required**: All public texts and metadata are open without authentication.
- **Robots.txt & Respect**:
  - Archive.org welcomes polite researchers and indexing agents.
  - Rate limiting minimum delay set to `MIN_REQUEST_DELAY_MS: 2000`.

---

### 7. Rate Limiting Signals
- **Throttling Interval**: $2000\text{ms}$ between consecutive requests.
- **HTTP Status Codes**: Normal 200 OK; if transient 503 or 429 occurs, exponential backoff handles retry per Phase 15.
