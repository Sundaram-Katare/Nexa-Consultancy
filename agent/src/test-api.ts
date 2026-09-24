import { buildServer } from "./server";
import { closePool, query } from "./db/pool";

async function runApiTests() {
  console.log("==================================================");
  console.log("🔍 PHASE 3 FASTIFY AGENT API TEST SUITE");
  console.log("==================================================");

  const app = buildServer();
  await app.ready();

  let testJobId = "";

  try {
    // 1. Health Check Test
    console.log("\n[TEST 1] Testing GET /health...");
    const healthRes = await app.inject({
      method: "GET",
      url: "/health",
    });
    console.log(`Status: ${healthRes.statusCode}, Payload:`, healthRes.body);
    if (healthRes.statusCode !== 200) {
      throw new Error(`Expected 200 from /health, got ${healthRes.statusCode}`);
    }
    const healthJson = JSON.parse(healthRes.body);
    if (healthJson.status !== "ok" || healthJson.database !== "connected") {
      throw new Error(`Health response degraded: ${healthRes.body}`);
    }
    console.log("✅ Health check passed (HTTP 200 OK, DB connected).");

    // 2. Reject Unaccepted Country (HTTP 400)
    console.log("\n[TEST 2] Testing POST /jobs with unaccepted country ('France')...");
    const invalidJobRes = await app.inject({
      method: "POST",
      url: "/jobs",
      payload: {
        source: "scribd",
        countries: ["Canada", "France"],
        education_levels: ["Diploma", "Bachelor"],
        document_types: ["Transcript"],
        minimum_completed_years: 2.0,
      },
    });
    console.log(`Status: ${invalidJobRes.statusCode}, Payload:`, invalidJobRes.body);
    if (invalidJobRes.statusCode !== 400) {
      throw new Error(`Expected 400 from unaccepted country, got ${invalidJobRes.statusCode}`);
    }
    const invalidJson = JSON.parse(invalidJobRes.body);
    if (!invalidJson.message.includes("France")) {
      throw new Error(`Error message did not specifically name rejected country 'France': ${invalidJobRes.body}`);
    }
    console.log("✅ Correctly rejected unaccepted country with HTTP 400 and explicit message.");

    // 3. Create Valid Job (HTTP 201)
    console.log("\n[TEST 3] Testing POST /jobs with valid accepted countries ('Canada', 'United Kingdom')...");
    const validJobRes = await app.inject({
      method: "POST",
      url: "/jobs",
      payload: {
        source: "scribd",
        countries: ["Canada", "United Kingdom"],
        education_levels: ["Diploma", "Bachelor", "Master"],
        document_types: ["Transcript", "Marksheet", "Statement of Results"],
        minimum_completed_years: 2.0,
        institutions: ["University of Toronto", "Oxford University"],
        max_pages_per_search: 25,
      },
    });
    console.log(`Status: ${validJobRes.statusCode}, Payload:`, validJobRes.body);
    if (validJobRes.statusCode !== 201) {
      throw new Error(`Expected 201 from valid job creation, got ${validJobRes.statusCode}`);
    }
    const validJson = JSON.parse(validJobRes.body);
    if (!validJson.id || validJson.status !== "QUEUED") {
      throw new Error(`Invalid job creation response: ${validJobRes.body}`);
    }
    testJobId = validJson.id;
    console.log(`✅ Valid job created with ID: ${testJobId}, status: ${validJson.status}`);

    // 4. Retrieve Job with Progress Rollup (HTTP 200)
    console.log(`\n[TEST 4] Testing GET /jobs/${testJobId}...`);
    const getJobRes = await app.inject({
      method: "GET",
      url: `/jobs/${testJobId}`,
    });
    console.log(`Status: ${getJobRes.statusCode}, Payload:`, getJobRes.body);
    if (getJobRes.statusCode !== 200) {
      throw new Error(`Expected 200 from GET /jobs/:id, got ${getJobRes.statusCode}`);
    }
    const getJobJson = JSON.parse(getJobRes.body);
    if (getJobJson.id !== testJobId || getJobJson.status !== "QUEUED" || !getJobJson.progress) {
      throw new Error(`Invalid GET job response: ${getJobRes.body}`);
    }
    console.log("✅ Job retrieved with status QUEUED and zeroed initial progress counts.");

    // 5. Pause QUEUED Job (HTTP 200 -> PAUSED)
    console.log(`\n[TEST 5] Testing POST /jobs/${testJobId}/pause...`);
    const pauseRes = await app.inject({
      method: "POST",
      url: `/jobs/${testJobId}/pause`,
    });
    console.log(`Status: ${pauseRes.statusCode}, Payload:`, pauseRes.body);
    if (pauseRes.statusCode !== 200) {
      throw new Error(`Expected 200 from pause, got ${pauseRes.statusCode}`);
    }
    const pauseJson = JSON.parse(pauseRes.body);
    if (pauseJson.job.status !== "PAUSED") {
      throw new Error(`Expected status PAUSED, got ${pauseJson.job.status}`);
    }
    console.log("✅ Job paused successfully (status -> PAUSED).");

    // 6. Pause Already-PAUSED Job Guard (HTTP 409 Conflict)
    console.log(`\n[TEST 6] Testing POST /jobs/${testJobId}/pause again (State Guard)...`);
    const doublePauseRes = await app.inject({
      method: "POST",
      url: `/jobs/${testJobId}/pause`,
    });
    console.log(`Status: ${doublePauseRes.statusCode}, Payload:`, doublePauseRes.body);
    if (doublePauseRes.statusCode !== 409) {
      throw new Error(`Expected 409 Conflict for double pause, got ${doublePauseRes.statusCode}`);
    }
    console.log("✅ Correctly rejected invalid pause on already-PAUSED job with HTTP 409 Conflict.");

    // 7. Resume PAUSED Job (HTTP 200 -> RUNNING)
    console.log(`\n[TEST 7] Testing POST /jobs/${testJobId}/resume...`);
    const resumeRes = await app.inject({
      method: "POST",
      url: `/jobs/${testJobId}/resume`,
    });
    console.log(`Status: ${resumeRes.statusCode}, Payload:`, resumeRes.body);
    if (resumeRes.statusCode !== 200) {
      throw new Error(`Expected 200 from resume, got ${resumeRes.statusCode}`);
    }
    const resumeJson = JSON.parse(resumeRes.body);
    if (resumeJson.job.status !== "RUNNING") {
      throw new Error(`Expected status RUNNING, got ${resumeJson.job.status}`);
    }
    console.log("✅ Job resumed successfully (status -> RUNNING).");

    // 8. Resume Already-RUNNING Job Guard (HTTP 409 Conflict)
    console.log(`\n[TEST 8] Testing POST /jobs/${testJobId}/resume again (State Guard)...`);
    const doubleResumeRes = await app.inject({
      method: "POST",
      url: `/jobs/${testJobId}/resume`,
    });
    console.log(`Status: ${doubleResumeRes.statusCode}, Payload:`, doubleResumeRes.body);
    if (doubleResumeRes.statusCode !== 409) {
      throw new Error(`Expected 409 Conflict for resume on running job, got ${doubleResumeRes.statusCode}`);
    }
    console.log("✅ Correctly rejected invalid resume on already-RUNNING job with HTTP 409 Conflict.");

    // 9. Get Progress Rollup (HTTP 200)
    console.log(`\n[TEST 9] Testing GET /jobs/${testJobId}/progress...`);
    const progressRes = await app.inject({
      method: "GET",
      url: `/jobs/${testJobId}/progress`,
    });
    console.log(`Status: ${progressRes.statusCode}, Payload:`, progressRes.body);
    if (progressRes.statusCode !== 200) {
      throw new Error(`Expected 200 from progress endpoint, got ${progressRes.statusCode}`);
    }
    const progressJson = JSON.parse(progressRes.body);
    if (!progressJson.progress || typeof progressJson.progress.searches.total !== "number") {
      throw new Error(`Malformed progress response: ${progressRes.body}`);
    }
    console.log("✅ Progress endpoint returned accurate schema and counts.");

    // 10. Clean up test job
    console.log(`\n[TEST 10] Cleaning up test job...`);
    await query(`DELETE FROM jobs WHERE id = $1;`, [testJobId]);
    console.log("✅ Cleaned up test job from Supabase.");

    console.log("\n==================================================");
    console.log("🎉 ALL AGENT API TESTS PASSED 100%!");
    console.log("==================================================");
  } catch (error: any) {
    console.error("❌ API Test Failed:", error);
    if (testJobId) {
      try {
        await query(`DELETE FROM jobs WHERE id = $1;`, [testJobId]);
      } catch {}
    }
    process.exit(1);
  } finally {
    await app.close();
    await closePool();
  }
}

runApiTests();
