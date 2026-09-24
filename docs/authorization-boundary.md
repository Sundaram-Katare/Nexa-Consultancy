# Authorization Boundary & Ethical Compliance Policy

This document establishes the strict operational, legal, and authorization boundaries for the Academic Transcript Harvesting System and Browser Automation Agent.

---

## 1. Core Authorization Principles

1. **Authorized Account Usage Only**:
   * The automation engine will operate against Scribd **exclusively using authorized account credentials provided by the employer**.
   * No unauthenticated brute-forcing, credential stuffing, or unauthorized account creation will take place.
   * Persistent browser session profiles and cookies will be maintained securely within encrypted/protected volume mounts.

2. **Strict Non-Bypass Policy**:
   * **No CAPTCHA Bypass**: The system will NOT incorporate CAPTCHA-solving bypass services (e.g. 2Captcha, Anti-Captcha, or automated solvers) designed to circumvent human verification challenges. If a CAPTCHA challenge is detected, the agent immediately pauses, logs the event, and requests human intervention or triggers an n8n notification.
   * **No Paid-Content / Paywall Bypass**: The system will NOT exploit vulnerabilities or use circumvention mechanisms to access documents restricted behind unauthorized paywalls or premium tiers not covered by the provided credentials.
   * **No Security Control Bypass**: The system will NOT tamper with security headers, token verification routines, or Web Application Firewall (WAF) countermeasures.

---

## 2. Development Phase Safeguards

* **SlideShare for Public Development Testing**:
  * During initial local development and exploratory adapter debugging, SlideShare and open public repositories will be used for testing public content discovery and parsing logic.
  * No aggressive load testing or unthrottled concurrent requests will be made during testing phases.

---

## 3. Public Source Verification Protocol

* **Verification of 3 Additional Free / Public Sources**:
  * Prior to writing or executing any adapter for the 3 additional candidate repositories (e.g., Internet Archive, CORE, Zenodo, Studocu public collections), each source must undergo formal compliance verification:
    1. **Public Availability**: The target documents must be legally public, openly accessible, or licensed under creative commons / public domain.
    2. **Terms of Service Review**: The platform's robots.txt and terms of access must permit programmatic querying for public metadata/documents.
    3. **No Private / PII Exposure**: The adapter must only ingest documents that have been published publicly by institutions or uploaders without violating privacy statutes.
  * Adapter development for a given candidate source will only commence once these criteria are validated and recorded.

---

## 4. Operational Safety & Rate Limiting

To prevent service degradation and ensure polite, humanized web interaction:
* **Polite Crawl Intervals**: Enforce configurable randomized jitter delays (e.g., 2–5 seconds) between page transitions.
* **Concurrency Limits**: Restrict simultaneous active browser tabs per target domain to 1–2 concurrent workers.
* **Automatic Abort on Throttling**: If an HTTP 429 (Too Many Requests), HTTP 403 (Forbidden), or bot challenge is returned, the engine must immediately back off with exponential retry limits and alert the control plane.
