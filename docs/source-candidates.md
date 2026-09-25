# Source Candidate Evaluation & Validation Matrix

This document records the systematic evaluation of candidate public data repositories for academic transcripts, curriculum records, and institutional education documents. Every candidate was evaluated against accessibility, legal access/Terms of Service, metadata richness, automation viability, and structure stability.

---

## 📊 Candidate Evaluation Table

| Site | Relevant Content Exists | Publicly Free Accessible | Useful Metadata Present | Terms / Access Rules Checked | Automation Apparently Allowed | Search & Pagination Understood | Document Structure Understood | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Internet Archive (`archive_org`)** | **Yes** (Institutional bulletins, university record books, sample transcripts, historical curricula) | **Yes** (100% free open access) | **Yes** (Title, creator/institution, date, subject tags, item ID) | **Yes** (Permits polite non-commercial public crawling per robots.txt) | **Yes** (Direct HTML / API with polite delay) | **Yes** (`/search.php?query=...&page=...` / `/advancedsearch.php`) | **Yes** (Standard details page, metadata block, OCR/text layers) | **VALIDATED SOURCE** |
| **Zenodo (`zenodo_core`)** | **Yes** (Open access academic datasets, degree outlines, course transcripts, institutional publications) | **Yes** (100% free open access, CC-licensed) | **Yes** (Creators, institutions, publication date, abstract, DOI) | **Yes** (OpenAIRE/CERN open access policy supports automated harvesting) | **Yes** (Polite rate limit with standard User-Agent) | **Yes** (`/records?q=...&page=...`) | **Yes** (Standard record viewer, rich Next.js/React semantic markup) | **VALIDATED SOURCE** |
| **StuDocu (`studocu`)** | **Yes** (Student study notes, syllabus overviews, university sample transcripts, exam records across 40+ countries) | **Yes** (Public preview of documents & search cards) | **Yes** (Title, institution, course name, academic year, page count) | **Yes** (Allows search indexing and public preview browsing) | **Yes** (Standard session delay $\ge 3000\text{ms}$) | **Yes** (`/en/search?q=...&page=...`) | **Yes** (Structured result cells, preview container, text layer) | **VALIDATED SOURCE** |
| **ResearchGate** | **Partial** (Research publications, occasional student thesis/transcripts) | **No** (Gated behind mandatory login / membership verification) | **Yes** (Authors, citations, DOI) | **Checked** (Strict ToS section 3.2 prohibits automated extraction) | **No** (Aggressive Cloudflare Turnstile bot challenges) | **Complex** (Dynamic AJAX with token verification) | **Gated** (Requires full session auth) | **REJECTED CANDIDATE** (Strict ToS anti-scraping & bot challenges) |
| **Academia.edu** | **Partial** (Academic papers, departmental papers) | **No** (Heavy paywall / premium "unlimited download" barrier) | **Yes** (Paper metadata) | **Checked** (ToS forbids automated spiders/crawlers) | **No** (Canvas text obfuscation and mandatory email lock) | **Gated** | **Obfuscated** | **REJECTED CANDIDATE** (Aggressive paywalls and DOM obfuscation) |
| **Course Hero** | **Yes** (Course materials, sample student records) | **No** (Subscription / credit paywall with blurred text content) | **Yes** (Course code, school) | **Checked** (Strict anti-scraping and IP block rules) | **No** (Aggressive IP throttling and CAPTCHA walls) | **Gated** | **Blurred** (Text is hidden behind unblur unlock fees) | **REJECTED CANDIDATE** (Commercial paywall and anti-bot measures) |
| **Chegg** | **No** (Q&A homework solutions, textbook solutions) | **No** (Mandatory paid subscription) | **No** (Irrelevant to official transcripts) | **Checked** (Strict automated query prohibition) | **No** (PerimeterX bot detection) | **Gated** | **Gated** | **REJECTED CANDIDATE** (Irrelevant content and strict commercial paywall) |

---

## 🎯 Selected Validated Sources for Phase 23

1. **Source 3: Internet Archive (`archive_org`)**
   - **Base URL**: `https://archive.org`
   - **Search Endpoint**: `https://archive.org/search.php?query={query}&page={page}`
   - **Delay Strategy**: $2000\text{ms}$ rate limit throttling
   - **Rationale**: World's largest open library of public university records, historical transcripts, and academic calendars with permanent, stable canonical URLs (`/details/{id}`).

2. **Source 4: Zenodo (`zenodo_core`)**
   - **Base URL**: `https://zenodo.org`
   - **Search Endpoint**: `https://zenodo.org/records?q={query}&page={page}`
   - **Delay Strategy**: $1500\text{ms}$ rate limit throttling
   - **Rationale**: European/Global open-access institutional repository funded by CERN/OpenAIRE, containing freely accessible university records and academic materials.

3. **Source 5: StuDocu (`studocu`)**
   - **Base URL**: `https://www.studocu.com`
   - **Search Endpoint**: `https://www.studocu.com/en/search?q={query}&page={page}`
   - **Delay Strategy**: $3000\text{ms}$ rate limit throttling
   - **Rationale**: Comprehensive international repository of university-specific curriculum overviews, course syllabi, and academic documentation.
