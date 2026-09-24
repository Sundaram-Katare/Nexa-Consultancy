# Architecture Decision Records (ADR)

This document outlines the foundational architectural decisions for the Reusable AI Browser Agent and Academic Transcript Harvesting System.

---

## ADR-001: Orchestration & Control Plane — n8n
* **Status**: Accepted
* **Context**: The automation pipeline requires complex workflow coordination, scheduled cron jobs, event-driven triggers, human-in-the-loop review nodes (for `Needs Review` transcripts), webhooks, and executive summary notifications/reports for management.
* **Decision**: Use **n8n** as the workflow orchestration and control plane.
* **Rationale**:
  * Visual, inspectable workflow execution with built-in retry logic, error triggers, and alerting.
  * Native integrations with webhooks, PostgreSQL, notification systems (Slack, Email, Discord), and file export pipelines.
  * Allows business logic and scheduling to be decoupled from the raw browser scraping engine.
  * Self-hostable alongside the agent stack via Docker Compose.
* **Tradeoffs**: Requires a separate lightweight container runtime and workflow configuration management.

---

## ADR-002: Core Execution Engine — TypeScript / Node.js
* **Status**: Accepted
* **Context**: The agent core must handle high-concurrency asynchronous I/O, robust DOM manipulation, structured schema validation, and flexible browser automation adapters.
* **Decision**: Implement the core execution engine in **TypeScript (Node.js 20+ LTS)**.
* **Rationale**:
  * First-class integration with Playwright and modern Chrome DevTools Protocol (CDP) bindings.
  * Strong static type safety and runtime schema enforcement using `Zod`.
  * Superior performance for asynchronous web scraping and event-driven architectures.
  * Rich ecosystem for document extraction, streaming data transformations, and local API servers.
* **Tradeoffs**: Native Node.js bindings require compilation steps handled cleanly within Docker.

---

## ADR-003: Single Source of Truth — PostgreSQL
* **Status**: Accepted
* **Context**: The system must persist search matrices, checkpoints, deduplication states, extracted transcript records, and audit logs with ACID compliance, robust indexing, and complex analytical query support.
* **Decision**: Use **PostgreSQL 16** as the authoritative single source of truth.
* **Rationale**:
  * Strong relational integrity and constraints ensuring deduplication and non-null minimum fields.
  * Powerful `JSONB` support for storing dynamic document metadata and raw DOM extracts without schema rigidity.
  * High-performance transactional checkpointing that survives abrupt process or machine restarts.
  * Rich analytical query capabilities for real-time management metrics (aggregations by country, institution, duration category).
* **Tradeoffs**: Requires database container hosting compared to a flat SQLite file, but provides superior concurrency and multi-process safety.

---

## ADR-004: Deployment & Portability — Docker Compose
* **Status**: Accepted
* **Context**: The solution must be easily installable on various Windows and Mac workstations with minimal manual environment setup, avoiding "works on my machine" issues.
* **Decision**: Package the entire stack using **Docker Compose**.
* **Rationale**:
  * Encapsulates all dependencies (PostgreSQL, n8n, Ollama, Node.js runtime, Playwright Chromium binaries, font packages) in reproducible containers.
  * Single-command startup (`docker compose up -d` or platform scripts `run.bat` / `run.sh`).
  * Cross-platform consistency across Windows (Docker Desktop / WSL2), macOS (Apple Silicon & Intel), and Linux.
* **Tradeoffs**: Requires Docker Desktop installed on the host machine.

---

## ADR-005: Local / Open-Source LLM Runtime — Ollama
* **Status**: Accepted
* **Context**: Heavy day-to-day browser automation and document classification must not burn paid OpenAI/Claude API credits for thousands of search iterations and document parsing tasks.
* **Decision**: Use **Ollama** as the local LLM inference runtime (utilizing models such as `llama3.2:3b`, `qwen2.5:7b`, or `phi3.5`).
* **Rationale**:
  * 100% local, zero-cost inference for unstructured transcript duration classification and metadata extraction.
  * OpenAI-compatible local REST API endpoint (`http://localhost:11434/v1`).
  * Hybrid classification design: Fast deterministic regex rules run first; Ollama is invoked only when heuristic confidence is borderline.
  * Zero external API credit consumption during routine scraping.
* **Tradeoffs**: Requires local host GPU/CPU resources; mitigated by selecting lightweight, highly-optimized 3B–7B quantized models.

---

## ADR-006: Agent REST API Framework — Fastify
* **Status**: Accepted
* **Context**: The agent execution engine must expose a fast, robust REST API for n8n triggers, CLI commands, status polling, and dynamic browser task dispatch.
* **Decision**: Use **Fastify** as the HTTP API framework.
* **Rationale**:
  * Extremely low overhead and high throughput compared to Express.
  * Native schema compilation and validation with JSON Schema / TypeBox / Zod.
  * Built-in OpenAPI (Swagger) documentation generation for seamless n8n HTTP Request node integration.
  * Clean plugin architecture and robust lifecycle hooks.
* **Tradeoffs**: Slightly more strict lifecycle idioms than legacy Express.

---

## ADR-007: Database Schema Migrations — node-pg-migrate
* **Status**: Accepted
* **Context**: Database schema changes (tables, indexes, views, constraints) must be version-controlled, reproducible, and automatically applied upon container boot.
* **Decision**: Use **node-pg-migrate** for managing SQL schema migrations.
* **Rationale**:
  * Lightweight, dependency-minimal migration tool tailored specifically for PostgreSQL.
  * Supports pure SQL migration scripts as well as programmatic TypeScript migrations.
  * Integrates seamlessly into the container startup pipeline (`npm run migrate up`).
  * Clear migration history table (`pgmigrations`) preventing duplicate execution.
* **Tradeoffs**: Requires maintaining explicit forward and rollback migration files.

---

## ADR-008: Browser Execution Strategy — Bundled Playwright in Agent Container
* **Status**: Accepted
* **Context**: The browser automation controller must interface with Google Chrome / Chromium with minimal latency, support persistent authenticated user profiles (for Scribd sessions), and avoid network overhead.
* **Decision**: **Bundle Playwright and Chromium directly inside the Agent container** rather than deploying a detached remote browser service (like Browserless or Selenium grid).
* **Rationale**:
  * Co-locates the Node.js agent logic with the browser process, eliminating websocket/remote CDP network latency and stream serialization overhead.
  * Simplifies stateful volume mounting for Chrome user-data directories, session cookies, and local persistent storage.
  * Streamlines the Docker Compose topology (1 fewer service to manage and monitor).
  * Direct filesystem access for downloading and parsing document previews and raw exports.
* **Tradeoffs**: Increases the Docker image size of the agent service (which is standard for headless browser images).
