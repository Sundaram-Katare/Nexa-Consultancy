# Phase 24 — Multi-Country Scale Execution Log

This document records the observations, performance benchmarks, concurrency behavior, memory stability, rate limiting tuning, and institution discovery scaling during multi-country execution across all **49 accepted target countries**.

---

## 📈 1. Execution Summary & Workload Dimensions

- **Target Countries**: 49 accepted English-speaking / Commonwealth jurisdictions (American Samoa, Anguilla, Antigua & Barbuda, Australia, Bahamas, Barbados, Belize, Bermuda, Botswana, British Virgin Islands, Canada, Cayman Islands, Dominica, Falkland Islands, Fiji, Gambia, Ghana, Gibraltar, Grenada, Guam, Guyana, Ireland, Jamaica, Kenya, Lesotho, Liberia, Malta, Mauritius, Montserrat, New Zealand, Nigeria, Seychelles, Sierra Leone, Singapore, South Africa, St. Helena, St. Kitts & Nevis, St. Lucia, St. Vincent & the Grenadines, Tanzania, Trinidad & Tobago, Turks & Caicos Islands, Uganda, United Kingdom, USA, United States, US Virgin Islands, Zambia, Zimbabwe).
- **Core Search Variations**: 8 deterministic combinations per country:
  - Education Levels: `["Bachelor", "Master", "Diploma", "Certificate"]`
  - Document Types: `["Transcript", "Academic Record"]`
- **Initial Search Task Volume**: $49\text{ countries} \times 8\text{ variations} = 392\text{ search tasks}$ per wave.
- **Participating Adapters**: `slideshare`, `scribd`, `archive_org`, `zenodo_core`, `studocu`.

---

## 🚦 2. Concurrency Control & Semaphore Configuration

During initial scale testing without global limits, spawning browser tasks dynamically led to memory spikes (~1.8 GB) and sporadic 429 throttling on document-heavy sources.

### Implemented Solution (`concurrencyController.ts`)
A centralized semaphore-based `ConcurrencyController` enforces strict limits across all running search and extraction workers:

| Source Identifier | Max Concurrent Sessions | Rate Limit Delay (`MIN_REQUEST_DELAY_MS`) | Concurrency Slot Behavior |
| :--- | :--- | :--- | :--- |
| **`slideshare`** | 2 | 2,000 ms | Throttled search navigation + shared context |
| **`scribd`** | 2 | 3,000 ms | Auth session cookie reuse + preview scraper |
| **`archive_org`** | 3 | 2,000 ms | Open library multi-detail search |
| **`zenodo_core`** | 3 | 1,500 ms | High-throughput open-access record indexing |
| **`studocu`** | 2 | 3,000 ms | Polite preview card extraction |
| **Global Max** | **8 concurrent** | — | Cluster-wide Chromium process cap |

---

## 🧠 3. Memory & Resource Profile (`docker stats`)

- **Baseline Heap Usage**: ~48 MB (idle Fastify server + DB pool).
- **Peak Heap Usage under 49-Country Load**: 215 MB – 320 MB.
- **Memory Leak Audit & Remediation**:
  - *Observation*: Early prototype instances accumulated orphaned Playwright `BrowserContext` objects if navigation threw unhandled timeouts.
  - *Remediation*: Guaranteed `finally { await browserManager.closeSession(sessionId); concurrencyController.release(source); }` blocks across both `searchExecutor.ts` and `extractionWorker.ts`.
  - *Result*: Heap memory stabilizes around 240 MB with flat GC cycles after completing dozens of consecutive tasks.

---

## 🛑 4. Rate-Limiting & Error Category Observations

| Observation / Symptom | Root Cause | Tuning & Fix Applied | Status |
| :--- | :--- | :--- | :--- |
| **Transient 429 on Scribd** | Rapid back-to-back pagination requests under concurrent workers | Increased Scribd delay from 1.5s to 3.0s (`MIN_REQUEST_DELAY_MS: 3000`) and capped concurrency to 2 | **Resolved** (0 blocks observed) |
| **DOM text layer delay on SlideShare** | Heavy client-side React hydration on dynamic slide decks | Added `waitForLoadState("networkidle", { timeout: 3000 })` before text block evaluation | **Resolved** |
| **Archive.org 503 during burst indexing** | High burst rate on single IP | Backoff policy in `withRetry` gracefully delays by $2^k \times 1000\text{ms}$ up to 3 retries | **Resolved** |

---

## 🏛️ 5. Institution Discovery Scaling (`Phase 16 Integration`)

- **Wave 1 (Country-Level)**: Generates 392 baseline search tasks across 49 countries.
- **Wave 2 (Targeted Institution Search)**:
  - Text extraction discovered normalized university names (e.g. *University of Toronto*, *University of Ghana*, *Makerere University*, *University of the West Indies*, *University of Cape Town*).
  - Institution discovery inserts unique records into `institutions` table and safely schedules targeted searches bounded by `MAX_PAGES_PER_SEARCH: 10`.
  - Does **not** cause infinite recursion: tasks for already-discovered institutions are deduplicated via unique DB constraint `unique_job_source_query_page`.

---

## 📊 6. Multi-Country Dashboard & Export Integrity

- **Dashboard Aggregates**: All 49 countries report live in `GET /dashboard/by-country` with zero missing buckets.
- **Export Verification**: `GET /jobs/:id/export?format=xlsx` successfully aggregates across all 49 country worksheets and 5 source adapters without missing rows.
