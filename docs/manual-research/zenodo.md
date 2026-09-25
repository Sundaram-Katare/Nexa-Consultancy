# Zenodo (zenodo_core) Manual Research & Technical Investigation

This document details the DOM structure, URL schemas, query parameters, text extraction layers, and rate limiting parameters for the `zenodo_core` adapter.

---

### 1. Homepage & Architecture
- **Base URL**: `https://zenodo.org`
- **Search URL Pattern**: `https://zenodo.org/records?q={query}&page={page}` (or `https://zenodo.org/records/{id}`)
- **Public vs Authenticated Access**:
  - **Search & Record Pages**: 100% open-access repository operated by CERN and OpenAIRE.
  - **Documents / Data Downloads**: Completely free under Creative Commons open licenses.

---

### 2. Search URL & Query Parameters
- **Query Parameter**: `q` (URL-encoded search string, e.g. `q=Nigeria+university+academic+transcript`)
- **Page Parameter**: `page` (1-indexed integer, e.g. `page=1`, `page=2`)
- **Example URL**: `https://zenodo.org/records?q=academic%20transcript&page=1`

---

### 3. Result Card DOM Structure
- **Card Container Selectors**:
  - `div.item`
  - `div[data-testid="search-result-item"]`
  - `div.search-result-item`
  - `li.search-result`
  - `div.ui.items > div.item`
- **Document ID Extraction**:
  - Extracted from URL path `/records/{id}` or link `href`.
  - Example: `https://zenodo.org/records/10045678` -> ID: `10045678`
- **Card Title Selectors**:
  - `h4.header a`
  - `a.title`
  - `div.header a`
  - `h3.header`
- **Card Metadata / Authors / Affiliations / Date**:
  - `div.extra span.creators`
  - `div.description`
  - `span.publication-date`
  - `div.labels .ui.label`

---

### 4. Pagination Behavior
- **Pagination Controls**:
  - Next Page Link: `a[aria-label="Next"]`, `a.item[rel="next"]`, `li.page-item a[aria-label="Next"]`
  - Direct URL Pagination: `page={page}` parameter is deterministically supported by Zenodo's search router.
- **End of Results Indicator**:
  - Empty search container (`div.no-results`, `div.ui.placeholder.segment`), or 0 result items rendered.

---

### 5. Document Page Structure & Evidence Blocks
- **Canonical URL**: `https://zenodo.org/records/{id}`
- **Document Title**:
  - `h1#record-title`
  - `h1.record-title`
  - `h1.header`
  - `meta[name="citation_title"]`
- **Document Description & Abstract**:
  - `div#record-description`
  - `div.record-description`
  - `div.abstract`
  - `meta[name="description"]`
- **Creator / Affiliation / Institution**:
  - `section#record-creators li`
  - `span.creator-name`
  - `span.creator-affiliation`
  - `meta[name="citation_author"]`
  - `meta[name="citation_author_institution"]`
- **Publication Date**:
  - `span#record-published-date`
  - `meta[name="citation_publication_date"]`
- **Document Body & Content Blocks**:
  - `div#record-description p`
  - `div.record-description`
  - `table.table td`
  - `div.ui.segment p`

---

### 6. Login Wall & Bot Rules
- **No Login Required**: Open science repository, fully public.
- **Rate Limiting Delay**: `MIN_REQUEST_DELAY_MS: 1500` (polite 1.5s delay).

---

### 7. Rate Limiting Signals
- Standard 200 OK. If rate limit is reached, standard 429 response is captured and backed off exponentially.
