import fs from "fs";
import path from "path";
import { buildServer } from "./server";
import { query } from "./db/pool";

async function runOrchestrationTests() {
  console.log("================================================================================");
  console.log("🧪 PHASE 17 — n8n Orchestration End-to-End Test Suite");
  console.log("================================================================================\n");

  // Step 1: Validate n8n Workflow JSON Artifacts
  console.log("--------------------------------------------------------------------------------");
  console.log("Step 1: Validating n8n Workflow JSON Scaffolds");
  console.log("--------------------------------------------------------------------------------");

  const workflowDir = path.resolve(__dirname, "../../n8n/workflows");
  const expectedWorkflows = [
    {
      file: "start-job.json",
      name: "Start Automation Job",
      expectedNodes: ["Webhook Trigger", "Validate Job Config", "POST /jobs (Create Job)", "POST /jobs/:id/plan (Generate Plan)", "Respond to Webhook"],
    },
    {
      file: "progress-poll.json",
      name: "Progress Poll",
      expectedNodes: ["Schedule (Every 5 Min)", "GET /jobs?status=RUNNING", "Split Jobs List", "GET /jobs/:id/progress", "Log Progress Rollup"],
    },
    {
      file: "resume-watcher.json",
      name: "Resume Watcher",
      expectedNodes: ["Schedule (Every 15 Min)", "GET /jobs?status=BLOCKED", "Split Blocked Jobs", "POST /jobs/:id/resume-full", "Log Auto-Resume Action"],
    },
    {
      file: "error-monitor.json",
      name: "Error Monitor",
      expectedNodes: ["Schedule (Every 10 Min)", "GET /errors (Unresolved Human-Action)", "Any Errors Requiring Action?", "Format Alert Payload"],
    },
    {
      file: "export.json",
      name: "Export Job Dataset",
      expectedNodes: ["Webhook Trigger", "Validate & Extract JobId", "POST /jobs/:id/export", "Respond to Webhook"],
    },
  ];

  for (const wf of expectedWorkflows) {
    const fullPath = path.join(workflowDir, wf.file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`❌ Missing required workflow JSON file: ${wf.file}`);
    }

    const rawContent = fs.readFileSync(fullPath, "utf8");
    let parsed: any;
    try {
      parsed = JSON.parse(rawContent);
    } catch (err: any) {
      throw new Error(`❌ Failed to parse JSON in ${wf.file}: ${err.message}`);
    }

    // Verify no Playwright/browser code is present
    if (rawContent.includes("playwright") || rawContent.includes("chromium") || rawContent.includes("page.goto")) {
      throw new Error(`❌ Architectural violation: Workflow ${wf.file} contains browser automation code! n8n must remain pure HTTP.`);
    }

    const nodeNames = (parsed.nodes || []).map((n: any) => n.name);
    for (const expectedNode of wf.expectedNodes) {
      const found = nodeNames.some((name: string) => name.includes(expectedNode) || expectedNode.includes(name));
      if (!found) {
        throw new Error(`❌ Workflow ${wf.file} missing expected node: ${expectedNode}`);
      }
    }

    console.log(`✅ [Workflow Valid] ${wf.file} -> "${parsed.name}" (${parsed.nodes.length} nodes, active: ${parsed.active})`);
  }

  // Step 2: Initialize Agent Fastify Server
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 2: Testing Agent API Endpoints for n8n Workflows");
  console.log("--------------------------------------------------------------------------------");

  const server = buildServer();
  await server.ready();

  // Test 2.1: Workflow 1 API Flow (Create Job -> Plan Tasks)
  console.log("\n[TEST 2.1] Workflow 1 API Contract: POST /jobs -> POST /jobs/:id/plan");
  const createJobRes = await server.inject({
    method: "POST",
    url: "/jobs",
    payload: {
      source: "slideshare",
      countries: ["Ghana"],
      education_levels: ["Bachelor", "Master"],
      document_types: ["Transcript"],
      minimum_completed_years: 2.0,
      max_pages_per_search: 2,
    },
  });

  if (createJobRes.statusCode !== 201) {
    throw new Error(`❌ POST /jobs failed with status ${createJobRes.statusCode}: ${createJobRes.body}`);
  }

  const jobData = JSON.parse(createJobRes.body);
  console.log(`✅ Job Created via API: ID=${jobData.id}, Status=${jobData.status}`);

  const planJobRes = await server.inject({
    method: "POST",
    url: `/jobs/${jobData.id}/plan`,
  });

  if (planJobRes.statusCode !== 200) {
    throw new Error(`❌ POST /jobs/:id/plan failed with status ${planJobRes.statusCode}: ${planJobRes.body}`);
  }

  const planData = JSON.parse(planJobRes.body);
  console.log(`✅ Search Plan Generated via API: TotalPlanned=${planData.totalPlanned}, CountriesPlanned=${planData.countriesPlanned?.join(", ")}`);

  // Test 2.2: Workflow 2 API Contract: GET /jobs?status=RUNNING -> GET /jobs/:id/progress
  console.log("\n[TEST 2.2] Workflow 2 API Contract: GET /jobs?status=X -> GET /jobs/:id/progress");
  // Set job status to RUNNING
  await query(`UPDATE jobs SET status = 'RUNNING' WHERE id = $1;`, [jobData.id]);

  const runningJobsRes = await server.inject({
    method: "GET",
    url: "/jobs?status=RUNNING",
  });

  if (runningJobsRes.statusCode !== 200) {
    throw new Error(`❌ GET /jobs?status=RUNNING failed with status ${runningJobsRes.statusCode}: ${runningJobsRes.body}`);
  }

  const runningJobsData = JSON.parse(runningJobsRes.body);
  console.log(`✅ GET /jobs?status=RUNNING returned ${runningJobsData.total} active jobs`);
  const foundRunningJob = runningJobsData.jobs.find((j: any) => j.id === jobData.id);
  if (!foundRunningJob) {
    throw new Error(`❌ Newly created RUNNING job ${jobData.id} not found in list output`);
  }

  const progressRes = await server.inject({
    method: "GET",
    url: `/jobs/${jobData.id}/progress`,
  });

  if (progressRes.statusCode !== 200) {
    throw new Error(`❌ GET /jobs/:id/progress failed with status ${progressRes.statusCode}: ${progressRes.body}`);
  }

  const progressData = JSON.parse(progressRes.body);
  console.log(`✅ GET /jobs/:id/progress returned metrics: Searches=${progressData.progress?.searches?.total}, Errors=${progressData.progress?.errors?.unresolved}`);

  // Test 2.3: Workflow 3 API Contract: GET /jobs?status=BLOCKED -> POST /jobs/:id/resume-full
  console.log("\n[TEST 2.3] Workflow 3 API Contract: GET /jobs?status=BLOCKED -> POST /jobs/:id/resume-full");
  // Set job status to BLOCKED
  await query(`UPDATE jobs SET status = 'BLOCKED' WHERE id = $1;`, [jobData.id]);

  const blockedJobsRes = await server.inject({
    method: "GET",
    url: "/jobs?status=BLOCKED",
  });

  if (blockedJobsRes.statusCode !== 200) {
    throw new Error(`❌ GET /jobs?status=BLOCKED failed with status ${blockedJobsRes.statusCode}: ${blockedJobsRes.body}`);
  }

  const blockedJobsData = JSON.parse(blockedJobsRes.body);
  console.log(`✅ GET /jobs?status=BLOCKED returned ${blockedJobsData.total} blocked jobs`);
  const foundBlocked = blockedJobsData.jobs.find((j: any) => j.id === jobData.id);
  if (!foundBlocked) {
    throw new Error(`❌ Job ${jobData.id} should appear in BLOCKED list`);
  }

  // Test resume-full endpoint response structure
  const resumeRes = await server.inject({
    method: "POST",
    url: `/jobs/${jobData.id}/resume-full`,
  });

  if (resumeRes.statusCode !== 200) {
    throw new Error(`❌ POST /jobs/:id/resume-full failed with status ${resumeRes.statusCode}: ${resumeRes.body}`);
  }

  const resumeData = JSON.parse(resumeRes.body);
  console.log(`✅ POST /jobs/:id/resume-full succeeded: JobId=${resumeData.job_id}, FinalStatus=${resumeData.finalStatus}`);

  // Test 2.4: Workflow 4 API Contract: GET /errors?resolved=false&requiresHumanIntervention=true -> POST /errors/:id/resolve
  console.log("\n[TEST 2.4] Workflow 4 API Contract: Error Monitoring & Human Alerting");

  // Insert a test CAPTCHA error requiring human intervention
  const errorInsertRes = await query<{ id: string }>(
    `INSERT INTO errors (
       job_id, error_category, message, retry_count, requires_human_intervention, details, resolved
     ) VALUES (
       $1, 'CAPTCHA_DETECTED', 'Cloudflare Turnstile challenge encountered during pagination', 3, true, '{"url": "https://www.slideshare.net/search"}', false
     ) RETURNING id;`,
    [jobData.id]
  );
  const testErrorId = errorInsertRes.rows[0].id;
  console.log(`✅ Injected Test Error requiring human intervention: ID=${testErrorId}`);

  // Query unresolved human-intervention errors
  const errorsRes = await server.inject({
    method: "GET",
    url: "/errors?resolved=false&requiresHumanIntervention=true",
  });

  if (errorsRes.statusCode !== 200) {
    throw new Error(`❌ GET /errors failed with status ${errorsRes.statusCode}: ${errorsRes.body}`);
  }

  const errorsData = JSON.parse(errorsRes.body);
  console.log(`✅ GET /errors?resolved=false&requiresHumanIntervention=true returned ${errorsData.total} error alerts`);
  const targetedError = errorsData.errors.find((e: any) => e.id === testErrorId);
  if (!targetedError) {
    throw new Error(`❌ Injected error ${testErrorId} not found in error monitor query response`);
  }
  if (targetedError.errorCategory !== "CAPTCHA_DETECTED" || !targetedError.requiresHumanIntervention) {
    throw new Error(`❌ Injected error details mismatched in error query`);
  }
  console.log(`✅ Verified alert fields: Category=${targetedError.errorCategory}, Message="${targetedError.message}", JobId=${targetedError.jobId}`);

  // Resolve the error
  const resolveRes = await server.inject({
    method: "POST",
    url: `/errors/${testErrorId}/resolve`,
  });

  if (resolveRes.statusCode !== 200) {
    throw new Error(`❌ POST /errors/:id/resolve failed with status ${resolveRes.statusCode}: ${resolveRes.body}`);
  }
  console.log(`✅ Marked error ${testErrorId} as resolved`);

  // Verify it is no longer returned in unresolved query
  const errorsAfterResolveRes = await server.inject({
    method: "GET",
    url: "/errors?resolved=false&requiresHumanIntervention=true",
  });
  const errorsAfterData = JSON.parse(errorsAfterResolveRes.body);
  const stillPresent = errorsAfterData.errors.some((e: any) => e.id === testErrorId);
  if (stillPresent) {
    throw new Error(`❌ Resolved error ${testErrorId} still appearing in unresolved errors query`);
  }
  console.log(`✅ Confirmed error ${testErrorId} is filtered out after resolution`);

  // Cleanup test error
  await query(`DELETE FROM errors WHERE id = $1;`, [testErrorId]);

  console.log("\n================================================================================");
  console.log("🎉 ALL PHASE 17 N8N ORCHESTRATION TESTS PASSED SUCCESSFULLY!");
  console.log("================================================================================\n");

  await server.close();
  process.exit(0);
}

runOrchestrationTests().catch((err) => {
  console.error("❌ Orchestration Test Failed:", err);
  process.exit(1);
});
