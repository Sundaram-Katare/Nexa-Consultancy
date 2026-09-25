# Nexa Consultancy — System Installation & Deployment Guide

This document provides a step-by-step installation walkthrough to deploy the AI-powered browser automation platform from scratch on any Windows, macOS, or Linux machine.

---

## 📋 Numbered Installation Walkthrough

### Step 1: Install Prerequisites & Docker Desktop
- Install **Docker Desktop** (version 24.0+ with Docker Compose v2):
  - [Docker Desktop for Windows / Mac / Linux](https://www.docker.com/products/docker-desktop/)
- Ensure **Git** and **Node.js** (v18+ or v20+ LTS) are installed.
- Ensure hardware virtualization (VT-x / AMD-V / WSL2 on Windows) is enabled in your BIOS.

---

### Step 2: Clone the Repository
```bash
git clone https://github.com/Sundaram-Katare/Nexa-Consultancy.git
cd Nexa-Consultancy
```

---

### Step 3: Configure Environment Variables
Copy the environment template from the `docker/` directory:
```bash
cp docker/.env.example docker/.env
```

Open `docker/.env` in your text editor and populate the required keys:

| Environment Variable | Description & Where to Obtain | Required? |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string (Supabase Cloud project or local Postgres) | **Yes** |
| `SUPABASE_URL` | Supabase API endpoint (e.g. `https://xxxx.supabase.co`) | Optional |
| `SUPABASE_ANON_KEY` | Supabase public anonymous API key | Optional |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role secret | Optional |
| `OLLAMA_URL` | Host/container URL for Ollama local service (`http://ollama:11434`) | **Yes** |
| `OLLAMA_MODEL` | Local LLM tag (default: `qwen2.5:3b` or `llama3.2:3b`) | **Yes** |
| `AGENT_PORT` | Fastify agent API and UI port (default: `3000`) | **Yes** |
| `SCRIBD_USERNAME` | Optional login email for Scribd adapter document downloads | Optional |
| `SCRIBD_PASSWORD` | Optional login password for Scribd adapter | Optional |
| `N8N_PORT` | n8n workflow management UI port (default: `5678`) | **Yes** |
| `N8N_ENCRYPTION_KEY` | 32-character random string for n8n credentials storage | **Yes** |

---

### Step 4: Launch Docker Stack
Navigate to the `docker/` directory and spin up the multi-container stack:
```bash
cd docker
docker compose up -d --build
```
This builds and launches:
- `nexa_agent` (Fastify API, Chromium Playwright browser instance, pipeline workers)
- `nexa_n8n` (Workflow orchestration engine)
- `nexa_n8n_init` (Automated workflow importer and activator that runs once after n8n is healthy)
- `nexa_ollama` (Local LLM inference container)

Verify all containers are running and `nexa_n8n_init` has exited cleanly:
```bash
docker compose ps
```

---

### Step 5: Pull the Ollama Local AI Model
Execute a one-time command to pull the quantized model into the persistent `nexa_ollama_models` volume:
```bash
docker exec -it nexa_ollama ollama pull qwen2.5:3b
```
*(Depending on your internet speed, this download takes approximately 1–3 minutes for the ~2.5 GB model weights).*

---

### Step 6: Initialize Database Schema (Migrations)
Apply the PostgreSQL migration scripts to seed the `countries` table, `sources` table, and all schema constraints:
```bash
docker exec -it nexa_agent npm run migrate:up
```

---

### Step 7: Access n8n Orchestrator & Create Owner Account
1. Open your browser to: **`http://localhost:5678`**
2. On first launch, enter your name, email, and password to set up your owner account.

---

### Step 8: Automated Workflow Activation
> [!NOTE]
> All 5 workflow automation pipelines (`start-job`, `progress-poll`, `resume-watcher`, `error-monitor`, `export`) are **automatically imported and activated** upon startup by the `n8n-init` container into the shared `n8n_data` volume. No manual JSON import or toggling is required.

You will see all 5 workflows immediately present and active in the n8n UI:
- `Start Job`: Webhook trigger to create and plan jobs
- `Progress Poll`: Scheduled heartbeat checking active job progress
- `Resume Watcher`: Auto-recovers stale or interrupted jobs
- `Error Monitor`: Flags errors requiring operator attention
- `Export`: Generates multi-sheet XLSX / CSV exports on demand

---

### Step 9: Open the Management Dashboard
Open your browser to: **`http://localhost:3000/ui/`**
- View live metric summary cards, classification distributions (`2+ Years`, `< 2 Years`, `Needs Review`), country breakdown, search task queues, and error monitor.
- The UI polls `GET /dashboard/summary` every 30 seconds automatically.

---

### Step 10: Trigger an Execution Job

You can trigger a job via **three interchangeable interfaces**:

#### Option A: Natural-Language Agent Command (Recommended)
```bash
curl -X POST http://localhost:3000/agent/command \
  -H "Content-Type: application/json" \
  -d '{"text": "Find academic transcripts for Canada and Ghana on slideshare"}'
```

#### Option B: Direct API Call
```bash
# 1. Create Job
JOB_ID=$(curl -s -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "source": "slideshare",
    "countries": ["Canada", "Ghana"],
    "education_levels": ["Bachelor", "Master"],
    "document_types": ["Transcript"],
    "minimum_completed_years": 2.0
  }' | grep -o '"id":"[^"]*' | cut -d'"' -f4)

# 2. Plan Deterministic Tasks
curl -X POST http://localhost:3000/jobs/$JOB_ID/plan

# 3. Drive Execution
curl -X POST http://localhost:3000/jobs/$JOB_ID/resume-full
```

#### Option C: Export Multi-Sheet XLSX
```bash
# Download complete 9-sheet Excel report
curl -O http://localhost:3000/export/xlsx
```

---

## 🔧 Step 11: Troubleshooting & Common Pitfalls

| Issue / Error | Cause | Resolution |
| :--- | :--- | :--- |
| **Port Conflict (`EADDRINUSE 3000` or `5678`)** | Another service on your host is using port 3000 or 5678 | Change `AGENT_PORT=3001` or `N8N_PORT=5679` in `docker/.env` and restart |
| **`AI_UNAVAILABLE` on NL / Ambiguity calls** | Ollama container is starting or model weights have not been pulled yet | Run `docker exec -it nexa_ollama ollama pull qwen2.5:4b-instruct` and verify `http://localhost:11434/api/tags` |
| **Database Connection Refused / SSL Error** | Supabase connection pooling requires SSL | Ensure `DATABASE_URL` contains `?sslmode=require` or correct pooling port `6543` |
| **Playwright Browser Navigation Timeout** | Slow internet or target website throttling | The built-in `withRetry` policy automatically retries with exponential backoff; check `MIN_REQUEST_DELAY_MS` in adapter config |
| **Slow First Container Build** | Initial Playwright Chromium base image download (~1.2 GB) | This is normal on clean systems; subsequent builds utilize Docker layer caching |
