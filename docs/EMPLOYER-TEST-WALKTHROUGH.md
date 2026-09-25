# Nexa Consultancy — Employer Testing & Deployment Walkthrough

This document is a comprehensive, end-to-end verification guide designed for evaluators and operators with **zero prior knowledge** of this codebase. It guides you from creating your own isolated cloud database to running live multi-country autonomous agent tasks and inspecting multi-sheet exports.

---

> [!IMPORTANT]
> **Hosted Cloud Database Architecture**:
> This platform uses **Supabase (hosted PostgreSQL)** as its database. No local PostgreSQL container is run in Docker. All state (jobs, search tasks, documents, evidence, classifications, checkpoints, and errors) is stored directly in your cloud Supabase project, ensuring persistent data ownership and zero risk of data loss on local container restarts.

---

## 📋 SECTION 0: Prerequisites

Before starting, ensure you have the following prerequisites ready:

### 1. Docker Desktop
- **Required**: Docker Desktop version 24.0+ with Docker Compose v2.
- **Download**: [Official Docker Desktop Download](https://www.docker.com/products/docker-desktop/)
- Ensure virtualization (WSL2 on Windows / Hyper-V / Apple Silicon Virtualization on Mac) is enabled.

### 2. Dedicated Supabase Project (Your Cloud Database)
You should create your **own dedicated Supabase project** for this deployment. 
- **Why**: This guarantees 100% data ownership, complete isolation from shared quotas, and allows you to inspect tables directly in your own cloud dashboard.
- **How to Create**:
  1. Log in to [Supabase](https://supabase.com/) and click **New Project**.
  2. Enter a **Name** (e.g. `nexa-academic-agent`), select a **Region** nearest to you (e.g., `us-east-1` or `eu-central-1`), and set a strong **Database Password** (remember this password!).
  3. Wait ~2 minutes for Supabase to provision your PostgreSQL database.
  4. **Find your Connection String**:
     - Navigate to **Project Settings** (gear icon in left sidebar) -> **Database**.
     - Scroll to **Connection string** -> select **URI** and choose **Session** (Port `5432`) or **Transaction Pooler** (Port `6543`).
     - Example URI: `postgresql://postgres.yourprojectref:yourpassword@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
  5. **Find your API Keys**:
     - Navigate to **Project Settings** -> **API**.
     - Copy the **Project URL** (`https://yourprojectref.supabase.co`), **anon / public** key, and **service_role** secret.

### 3. Source Credentials & AI Model Configuration
- **Scribd Credentials** *(Optional)*: If you have a Scribd account, you can supply `SCRIBD_USERNAME` and `SCRIBD_PASSWORD` in `.env` to enable full document downloads; if omitted, the adapter runs safely in public guest/preview mode.
- **Ollama AI Model**: The system runs local quantized LLMs (default: `qwen2.5:4b-instruct`) inside Docker for schema-enforced query parsing and ambiguity resolution.

### 4. Minimum Machine Specifications
- **Disk Space**: At least **8 GB** free disk space for Docker base images (Playwright Chromium ~1.2 GB and Ollama model weights ~2.5 GB). Local database storage is not required since PostgreSQL is hosted on Supabase.
- **RAM**: Minimum 8 GB RAM (16 GB recommended for running Playwright and local LLM simultaneously).

---

## 🗄️ SECTION 1: Run Database Migrations Against Supabase

Before launching the Docker container stack, run the database migrations to provision the schema tables, constraints, and country seed data in your Supabase database.

### Step 1.1: Install Agent Dependencies Locally
Open a terminal in the project repository root and navigate to `/agent`:
```bash
cd agent
npm install
```

### Step 1.2: Execute Migrations Pointed at Supabase
Set the `DATABASE_URL` environment variable to your Supabase connection URI and run the migration:

**On Windows (PowerShell):**
```powershell
$env:DATABASE_URL="postgresql://postgres.yourprojectref:yourpassword@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require"
npm run migrate:up
```

**On macOS / Linux (Bash):**
```bash
DATABASE_URL="postgresql://postgres.yourprojectref:yourpassword@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require" npm run migrate:up
```

**Expected Result**:
```text
> nexa-agent@1.0.0 migrate:up
> node-pg-migrate -m migrations up

> Migrating files:
> - 001_initial_schema
> - 002_document_extraction_fields
> - 003_relevance_status_values
> - 004_evidence_signals
> - 005_classification_reasoning
> - 006_checkpoint_upsert_constraint
> - 007_error_handling_fields
> - 008_institutions
> - 009_job_metrics
Migrations complete!
```

### Step 1.3: Confirm Tables in Supabase Dashboard
1. Open your **Supabase Dashboard** -> click on **Table Editor** (grid icon in left menu).
2. Confirm the presence of the following **11 schema tables**:
   - `countries` (seeded with target jurisdictions)
   - `sources` (seeded with target repositories: `slideshare`, `scribd`, `archive_org`, `zenodo_core`, `studocu`)
   - `jobs`
   - `search_tasks`
   - `search_history`
   - `documents`
   - `document_evidence`
   - `evidence_signals`
   - `classifications`
   - `checkpoints`
   - `errors`
   - `institutions`
   - `job_metrics`

### Step 1.4: Confirm 49 Accepted Countries Seeded
In the Supabase dashboard, open the **SQL Editor** and run:
```sql
SELECT count(*) as total_countries, count(*) FILTER (WHERE is_accepted = true) as accepted_countries 
FROM countries;
```
**Expected Output**:
| total_countries | accepted_countries |
| :--- | :--- |
| `49` | `49` |

---

## 🐳 SECTION 2: Fresh Docker Install

Now launch the microservice container stack locally via Docker Compose.

### Step 2.1: Configure `docker/.env`
Navigate to the `docker/` directory and copy the environment template:
```bash
cd ../docker
cp .env.example .env
```

Open `docker/.env` in your text editor and paste your Supabase connection parameters:
```env
# ==========================================
# 1. Supabase Cloud Database Configuration
# ==========================================
DATABASE_URL=postgresql://postgres.yourprojectref:yourpassword@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require
SUPABASE_URL=https://yourprojectref.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# ==========================================
# 2. Local AI / Ollama Configuration
# ==========================================
OLLAMA_URL=http://ollama:11434
OLLAMA_HOST_PORT=11434
OLLAMA_MODEL=qwen2.5:4b-instruct

# ==========================================
# 3. Agent & UI Configuration
# ==========================================
AGENT_PORT=3000
NODE_ENV=development
LOG_LEVEL=info
DEBUG_SQL=false

# Optional Source Credentials
SCRIBD_USERNAME=
SCRIBD_PASSWORD=

# ==========================================
# 4. n8n Workflow Automation Configuration
# ==========================================
N8N_PORT=5678
N8N_HOST=localhost
N8N_PROTOCOL=http
N8N_ENCRYPTION_KEY=nexa_super_secret_encryption_key_32chars
GENERIC_TIMEZONE=UTC
```

### Step 2.2: Launch Docker Compose
Run the following command from the `docker/` directory:
```bash
docker compose up -d --build
```

**What Happens Automatically**:
1. `nexa_ollama` launches local model hosting.
2. `nexa_agent` builds Playwright Chromium container and starts the Fastify API.
3. `nexa_n8n` initializes the orchestration engine.
4. `nexa_n8n_init` waits for `nexa_n8n` healthcheck to pass, imports all 5 workflows from `n8n/workflows/`, activates them, and exits with code 0.

### Step 2.3: Pull Local AI Model (One-Time Step)
Pull the instruction model weights into Ollama:
```bash
docker exec -it nexa_ollama ollama pull qwen2.5:4b-instruct
```
**Expected Result**:
```text
pulling manifest
pulling 4b-instruct... 100% ▕████████████████████████▏ 2.5 GB
verifying sha256 digest
writing manifest
success
```

---

## 🔍 SECTION 3: Confirm Every Container Is Actually Healthy

Verify that the local services are running and healthy:

```bash
docker compose ps
```

### Expected State Table:
| Container Name | Service | Status | Expected Port Mapping |
| :--- | :--- | :--- | :--- |
| `nexa_agent` | `agent` | **Up / Running** | `0.0.0.0:3000->3000/tcp` |
| `nexa_n8n` | `n8n` | **Up (healthy)** | `0.0.0.0:5678->5678/tcp` |
| `nexa_ollama` | `ollama` | **Up / Running** | `0.0.0.0:11434->11434/tcp` |
| `nexa_n8n_init` | `n8n-init` | **Exited (0)** | *(One-shot task container)* |

### Inspect Container Logs:
To verify that `nexa_n8n_init` imported workflows successfully:
```bash
docker compose logs n8n-init
```
**Expected Output**:
```text
Importing workflows from /workflows...
  -> error-monitor.json
  -> export.json
  -> progress-poll.json
  -> resume-watcher.json
  -> start-job.json
Activating all imported workflows...
Workflow import complete.
```

---

## 🌐 SECTION 4: Confirm the Agent Can Reach Supabase

Because Supabase is a remote cloud database, test network connectivity from inside the `nexa_agent` container.

### Step 4.1: Test Agent API Health Check
Run the following curl command:
```bash
curl -s http://localhost:3000/health
```

**Expected JSON Response (HTTP 200 OK)**:
```json
{
  "status": "ok",
  "service": "nexa-agent",
  "version": "1.0.0",
  "timestamp": "2026-09-25T09:30:00.000Z",
  "database": "connected"
}
```

### What a Database Connection Failure Looks Like:
If the `DATABASE_URL` password is wrong or outbound port 6543/5432 is blocked by a firewall, `/health` returns HTTP 503:
```json
{
  "status": "degraded",
  "service": "nexa-agent",
  "database": "disconnected"
}
```
*Remedy*: Re-check the password in `docker/.env` and ensure `?sslmode=require` is appended to the connection string.

---

## 💾 SECTION 5: Where the Data Lives (Supabase, Not Local Disk)

All persistent data generated by the platform is stored directly in your **Supabase PostgreSQL instance**, not in local Docker container layers or temporary files.

### Inspecting Data in Supabase:
1. Open your **Supabase Dashboard** -> **Table Editor**.
2. Click on the `documents` table. After running the demo job in Section 8, you will see rows with:
   - `id` (UUID)
   - `canonical_url` (Permanent link to source presentation/record)
   - `title` (Normalized document title)
   - `status` (`EXTRACTED` or `CLASSIFIED_PENDING`)
   - `country_id` (Foreign key referencing `countries.id`)
3. Click on the `classifications` table to see anti-hallucination verification records:
   - `classification` (`TWO_PLUS_YEARS`, `LESS_THAN_TWO_YEARS`, or `NEEDS_REVIEW`)
   - `completed_years` (Calculated duration, e.g. `4.0`)
   - `confidence` (e.g. `0.95`)
   - `verification_status` (`VERIFIED` or `RULE_BASED`)

> [!NOTE]
> Because storage is hosted in the cloud, all discovered records, evidence rows, and classification audit histories remain safe and accessible even if you restart your machine or destroy local Docker containers.

---

## ⚙️ SECTION 6: Where to Find & Confirm n8n Workflows

1. Open your browser to: **`http://localhost:5678`**
2. On first launch, create your owner account (enter your name, email, and password).
3. In the left navigation menu, click **Workflows**.
4. Confirm all **5 pre-imported workflows** are listed and show **Active**:
   - `Start Job`: Accepts webhook triggers to create and plan multi-country jobs.
   - `Progress Poll`: Polls `GET /jobs/:id/progress` every 5 minutes for active jobs.
   - `Resume Watcher`: Automatically detects stale/interrupted tasks and executes `POST /jobs/:id/resume-full`.
   - `Error Monitor`: Monitors unresolved errors flagged for human intervention.
   - `Export`: Generates multi-sheet Excel / CSV files on webhook trigger.
5. Click on **Start Job** to inspect its visual nodes (`Webhook -> Validate Body -> HTTP Create Job -> HTTP Plan Job -> Respond to Webhook`).

---

## 📊 SECTION 7: Confirm the Dashboard Loads

1. Open your browser to: **`http://localhost:3000/ui/`**
2. **Initial State**:
   - Total Documents: `0`
   - 2+ Years: `0`
   - Less than 2 Years: `0`
   - Needs Review: `0`
   - Active Searches: `0`
   - Target Countries Table: Lists all 49 countries ready for harvest.

---

## 🚀 SECTION 8: Run the Primary Demo Command (End-to-End Test)

Submit a natural-language command to execute a real academic transcript discovery and classification run.

### Step 8.1: Submit Natural-Language Command
Run this command from your terminal:
```bash
curl -X POST http://localhost:3000/agent/command \
  -H "Content-Type: application/json" \
  -d '{"text": "Find Bachelor and Master degree transcripts for Canada on slideshare"}'
```

**Expected JSON Response (HTTP 201 Created)**:
```json
{
  "statusCode": 201,
  "message": "Job created and search tasks planned successfully via Natural Language Agent",
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "parsed_plan": {
    "source": "slideshare",
    "countries": ["Canada"],
    "education_levels": ["Bachelor", "Master"],
    "document_types": ["Transcript"],
    "minimum_completed_years": 2,
    "max_pages_per_search": 10
  },
  "planned_tasks": {
    "createdCount": 8,
    "countriesPlanned": ["Canada"]
  }
}
```

*(Copy the returned `"job_id"` for the next steps)*.

### Step 8.2: Drive Execution Pipeline
Execute the full search, extraction, relevance filtering, and classification pipeline:
```bash
curl -X POST http://localhost:3000/jobs/<YOUR_JOB_ID>/resume-full
```

**Expected Pipeline Lifecycle**:
1. **Stage 1 (Search Tasks)**: Chromium navigates to SlideShare, queries `"Canada Bachelor transcript"`, parses result cards, and ingests document URLs into Supabase with deduplication.
2. **Stage 2 (Extraction)**: Opens document detail pages, extracts metadata, description, and visible text layers into `document_evidence`.
3. **Stage 3 (Relevance Filter)**: Evaluates academic keywords and document authenticity scores.
4. **Stage 4 (2-Year Classifier)**: Scans extracted text signals for `DATE_RANGE` (e.g. `2018 - 2022`), `YEAR_COUNT` (`completed 4 years`), and conformed degree statements to classify as `TWO_PLUS_YEARS`.

### Step 8.3: Monitor Live Progress
- In your browser at **`http://localhost:3000/ui/`**, watch the counters increment live.
- In **n8n** (`http://localhost:5678` -> **Executions** tab), observe the execution log.

---

## 📈 SECTION 9: Confirm Real Results & Multi-Sheet XLSX Export

### Step 9.1: Check Dashboard Aggregates
Refresh **`http://localhost:3000/ui/`** and verify:
- Total Documents $> 0$
- `TWO_PLUS_YEARS` breakdown $> 0$
- Country table shows completed search counts for **Canada**.

### Step 9.2: Download Multi-Sheet XLSX Report
Download the complete Excel report generated by the ExcelJS export engine:
```bash
curl -o nexa_transcript_report.xlsx "http://localhost:3000/jobs/<YOUR_JOB_ID>/export?format=xlsx"
```

Open `nexa_transcript_report.xlsx` in Microsoft Excel, LibreOffice, or Google Sheets. Confirm the presence of **all 9 dedicated sheets**:
1. `Summary`: Overall totals, unique vs duplicate counts, classification distribution.
2. `Accepted_2Plus`: Rows matching $\ge 2$ years duration with columns (`Country`, `Institution`, `Document Title`, `Education Level`, `Program`, `Duration Text`, `Completed Years`, `Canonical URL`).
3. `Less_Than_2`: Credentials under 2 years (e.g. 1-year certificates).
4. `Needs_Review`: Ambiguous records with explicit review reasoning.
5. `By_Country`: Metrics aggregated by jurisdiction.
6. `By_Institution`: Discovered universities and colleges.
7. `Duplicates`: Flagged duplicate items with duplicate reason and confidence.
8. `Errors`: Operational errors and retry audits.
9. `Search_Progress`: Completed search query log with raw result counts.

### Step 9.3: Cross-Verify with Supabase Table Editor
Open your **Supabase Table Editor** -> `classifications` table and confirm the records match row-for-row with the `Accepted_2Plus` worksheet.

---

## 🔄 SECTION 10: Test Restart Recovery (Live Proof)

Prove that interrupting the local container mid-run causes **zero data loss** and resumes seamlessly.

### Step 10.1: Restart the Agent Container
```bash
docker restart nexa_agent
```

### Step 10.2: Trigger Resumption
```bash
curl -X POST http://localhost:3000/jobs/<YOUR_JOB_ID>/resume-full
```

**Expected Result**:
The agent inspects Supabase entity tables, detects existing completed tasks without duplicating them, and completes any remaining work in seconds.

---

## 🛑 SECTION 11: Shut Down Cleanly

To stop the local container stack:
```bash
cd docker
docker compose down
```

> [!TIP]
> **Data Preservation**: Because all data lives in your cloud Supabase database, running `docker compose down` stops local compute without deleting any extracted documents, evidence signals, or classification tables. When you run `docker compose up -d` later, everything picks up right where you left off.

If you ever wish to completely wipe your project data, delete tables or reset your database directly in the **Supabase Dashboard** (**SQL Editor** -> `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` followed by running `npm run migrate:up`).

---

## 🛠️ SECTION 12: Troubleshooting Matrix

| Issue Encountered | Root Cause | Exact Fix |
| :--- | :--- | :--- |
| **`database: disconnected` on `/health`** | Supabase database paused or incorrect connection string | 1. Check if Supabase free project is paused (click **Restore** in dashboard).<br>2. Verify `DATABASE_URL` in `docker/.env` has correct password and port `6543` / `5432`. |
| **Port Conflict (`bind: address already in use :3000` or `:5678`)** | Local process already using port 3000 or 5678 | Update `AGENT_PORT=3001` or `N8N_PORT=5679` in `docker/.env`, then restart with `docker compose up -d`. |
| **`AI_UNAVAILABLE` on `/agent/command`** | Ollama container still starting or model not pulled | Run `docker exec -it nexa_ollama ollama pull qwen2.5:4b-instruct` and confirm model appears in `docker exec -it nexa_ollama ollama list`. |
| **`n8n-init` shows exited with non-zero code** | Started before n8n became healthy | Ensure `docker compose up -d` uses the built-in healthcheck. Re-run `docker compose up n8n-init` to re-import if needed. |
| **Playwright Browser Timeout** | Slow target server response | The built-in retry wrapper automatically retries up to 3 times with exponential backoff. You can tune `MIN_REQUEST_DELAY_MS` in adapter configuration if needed. |
