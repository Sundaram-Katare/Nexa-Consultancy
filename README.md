# AI Browser Automation & Academic Transcript Harvesting System

A general-purpose, reusable AI-powered Google Chrome browser automation system and data harvesting platform designed to discover, extract, classify, and organize academic transcripts and records across 47 target countries from Scribd and authorized public repositories.

---

## 🚀 Key Highlights & Capabilities

* **General-Purpose Reusable AI Agent**: Built as an extensible, pluggable browser automation framework capable of arbitrary web navigation, structured parsing, deep pagination traversal, and checkpoint recovery.
* **Zero-Cost / Open-Source AI Classification**: Employs a hybrid classification pipeline utilizing deterministic regular expression heuristics alongside a local **Ollama** LLM (Llama 3.2 / Qwen 2.5) to avoid expensive per-action cloud API costs.
* **3-Tier Dataset Separation**:
  1. `Accepted – 2 Years or More`: Complete multi-year academic transcripts / degree records.
  2. `Less Than 2 Years`: Single-semester, single-year, or shorter diploma/certificate records.
  3. `Needs Review`: Records with ambiguous or unconfirmed duration markers.
* **Country-Wise Partitioned Hierarchy**: Automatically segments results into country-specific datasets across all 47 target jurisdictions.
* **Enterprise Control Plane**: **n8n** orchestration engine for scheduled crawls, review queues, automated CSV/Excel exports, and executive management metrics.
* **ACID Persistence & Resilience**: Backed by **PostgreSQL 16** with checkpointing and state tracking that survives browser crashes, network dropouts, and host machine restarts.

---

## 📁 Repository Structure

```
.
├── /agent          # TypeScript / Node.js execution engine & Playwright browser controller
│   ├── src/        # Source code (API, Adapters, Classifier, Query Generator)
│   └── tests/      # Automated unit and integration test suites
├── /docker         # Docker Compose configuration and container Dockerfiles
│   ├── docker-compose.yml
│   └── Dockerfile.agent
├── /docs           # Architecture, requirements, and compliance documentation
│   ├── architecture-decisions.md     # ADRs for n8n, TS/Node, Postgres, Ollama, Fastify, etc.
│   ├── authorization-boundary.md     # Ethical bounds, non-bypass policies, rate limits
│   ├── open-questions.md             # Open clarification log for manual completion
│   └── requirements-matrix.md        # Full requirement traceability and test strategy
├── /n8n            # n8n workflows, triggers, notification nodes, and export pipelines
├── .gitignore      # Comprehensive repository ignore rules
└── README.md       # Project overview and operations guide
```

---

## 🏛️ System Architecture

```
[ Management UI / n8n Orchestrator ]
                │
                ▼ (REST API / Webhooks)
[ Fastify Agent API Layer ]
                │
                ▼
[ Browser Controller (Playwright Bundled) ] ◄──► [ Local Ollama LLM / Rule Classifier ]
                │                                                    │
                ▼                                                    ▼
   [ Source Adapters (Scribd, etc.) ] ──────────────► [ PostgreSQL 16 Source of Truth ]
                                                                     │
                                                                     ▼
                                                      [ Multi-format Exporter (CSV/XLSX) ]
```

---

## 📋 Documentation Index

* [Requirements Matrix](docs/requirements-matrix.md): Full requirement mapping, task quotes, classification, satisfaction plans, and testing methodologies.
* [Architecture Decision Records (ADR)](docs/architecture-decisions.md): Detailed rationales for choosing n8n, TypeScript/Node.js, PostgreSQL, Docker Compose, Ollama, Fastify, node-pg-migrate, and bundled Playwright.
* [Authorization Boundary & Ethical Policy](docs/authorization-boundary.md): Explicit commitments regarding authorized account usage, strict non-bypass of CAPTCHAs and paywalls, and compliance verification for external sources.
* [Open Questions Log](docs/open-questions.md): Tracking sheet for operational parameters and business confirmations.

---

## 🛠️ Getting Started (Phase by Phase)

* **Phase 0**: Project repository scaffolding, compliance boundaries, requirements matrix, and ADR definition (Current).
* **Phase 1**: Database schema migrations (node-pg-migrate), PostgreSQL setup, and combinatorial search space seeding.
* **Phase 2**: Playwright browser automation controller, session management, and Scribd adapter implementation.
* **Phase 3**: Rule-based regex tokenizers and local Ollama LLM classification pipeline.
* **Phase 4**: Verification and implementation of 3 additional legal public document sources.
* **Phase 5**: n8n workflow pipelines, management metrics dashboard, and automated country-wise file exports.
* **Phase 6**: Cross-platform packaging, end-to-end integration tests, and disaster recovery validation.
