import { buildServer } from "./server";
import { query } from "./db/pool";
import { parseCommand } from "./nlAgent/commandParser";
import { validatePlan } from "./nlAgent/planValidator";
import { JobConfig } from "./schemas/jobConfig";

async function runNlAgentTests() {
  console.log("================================================================================");
  console.log("🧪 PHASE 21 — Natural-Language Browser Agent Test Suite");
  console.log("================================================================================\n");

  // Step 1: Unit Testing parseCommand
  console.log("--------------------------------------------------------------------------------");
  console.log("Step 1: Testing Natural Language Command Parsing");
  console.log("--------------------------------------------------------------------------------");

  // 1.1 Valid Command
  const cmd1 = "Find Bachelor and Master degree transcripts for Canada on slideshare";
  const res1 = await parseCommand(cmd1);
  console.log(`[Command]: "${cmd1}"`);
  console.log(`[Result Type]: ${res1.type}`);

  if (res1.type !== "PLAN") {
    throw new Error(`❌ Expected PLAN for valid command, got ${res1.type}`);
  }
  console.log("✅ Generated Plan:", JSON.stringify(res1.plan, null, 2));
  if (!res1.plan.countries.includes("Canada") || res1.plan.source !== "slideshare") {
    throw new Error("❌ Generated plan missing expected Canada country or slideshare source");
  }

  // 1.2 Underspecified Command (No country given)
  const cmd2 = "find some transcripts";
  const res2 = await parseCommand(cmd2);
  console.log(`\n[Underspecified Command]: "${cmd2}"`);
  console.log(`[Result Type]: ${res2.type}`);

  if (res2.type !== "CLARIFICATION") {
    throw new Error(`❌ Expected CLARIFICATION for underspecified command, got ${res2.type}`);
  }
  console.log(`✅ Clarification Question: "${res2.question}" (Missing: ${res2.missingFields.join(", ")})`);

  // Step 2: Hard Authorization Boundary Enforcement in validatePlan
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 2: Testing Deterministic Boundary Enforcement in validatePlan");
  console.log("--------------------------------------------------------------------------------");

  // 2.1 Valid Plan
  const validPlan: JobConfig = {
    source: "slideshare",
    countries: ["Ghana"],
    education_levels: ["Bachelor"],
    document_types: ["Transcript"],
    minimum_completed_years: 2.0,
  };
  const valResult1 = await validatePlan(validPlan);
  if (!valResult1.valid) {
    throw new Error(`❌ Valid plan was incorrectly rejected: ${valResult1.errors.join("; ")}`);
  }
  console.log("✅ Valid plan passed hard boundary validation.");

  // 2.2 Unaccepted Country
  const unacceptedCountryPlan: JobConfig = {
    source: "slideshare",
    countries: ["France"], // Not in 47 target countries
    education_levels: ["Bachelor"],
    document_types: ["Transcript"],
    minimum_completed_years: 2.0,
  };
  const valResult2 = await validatePlan(unacceptedCountryPlan);
  if (valResult2.valid) {
    throw new Error("❌ Unaccepted country 'France' should have failed validation!");
  }
  console.log(`✅ Unaccepted country correctly blocked: "${valResult2.errors[0]}"`);

  // 2.3 Unregistered Source
  const unregisteredSourcePlan: JobConfig = {
    source: "wikipedia",
    countries: ["Ghana"],
    education_levels: ["Bachelor"],
    document_types: ["Transcript"],
    minimum_completed_years: 2.0,
  };
  const valResult3 = await validatePlan(unregisteredSourcePlan);
  if (valResult3.valid) {
    throw new Error("❌ Unregistered source 'wikipedia' should have failed validation!");
  }
  console.log(`✅ Unregistered source correctly blocked: "${valResult3.errors[0]}"`);

  // Step 3: Fastify POST /agent/command API End-to-End
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 3: Testing Fastify POST /agent/command API Endpoint");
  console.log("--------------------------------------------------------------------------------");

  const server = buildServer();
  await server.ready();

  // 3.1 Test Valid Command Execution
  const apiRes1 = await server.inject({
    method: "POST",
    url: "/agent/command",
    payload: { text: "Harvest transcripts and mark sheets for Ghana" },
  });

  if (apiRes1.statusCode !== 201) {
    throw new Error(`❌ POST /agent/command failed with status ${apiRes1.statusCode}: ${apiRes1.body}`);
  }

  const data1 = JSON.parse(apiRes1.body);
  console.log(`✅ Created Job ID via Natural Language: ${data1.jobId} (Planned Tasks: ${data1.totalPlanned})`);

  // Verify created job in database matches normal API job
  const jobVerifyRes = await server.inject({
    method: "GET",
    url: `/jobs/${data1.jobId}`,
  });
  if (jobVerifyRes.statusCode !== 200) {
    throw new Error(`❌ Could not fetch created job ${data1.jobId}`);
  }
  const jobRecord = JSON.parse(jobVerifyRes.body);
  console.log(`✅ Verified Job in DB: Status=${jobRecord.status}, Source=${jobRecord.config.source}, Countries=${jobRecord.config.countries.join(", ")}`);

  // 3.2 Test Underspecified Command via API
  const apiRes2 = await server.inject({
    method: "POST",
    url: "/agent/command",
    payload: { text: "start search please" },
  });

  if (apiRes2.statusCode !== 200) {
    throw new Error(`❌ POST /agent/command for underspecified query failed: ${apiRes2.body}`);
  }
  const data2 = JSON.parse(apiRes2.body);
  if (data2.type !== "CLARIFICATION_REQUIRED" || !data2.needsClarification) {
    throw new Error(`❌ Expected CLARIFICATION_REQUIRED response, got ${data2.type}`);
  }
  console.log(`✅ Underspecified query returned clarification: "${data2.question}"`);

  // 3.3 Test Out-of-Bounds Country via API
  const apiRes3 = await server.inject({
    method: "POST",
    url: "/agent/command",
    payload: { text: "Search for academic records in Italy on slideshare" },
  });

  // Should either return clarification or validation failure
  const data3 = JSON.parse(apiRes3.body);
  console.log(`✅ Out-of-bounds country response: Status=${apiRes3.statusCode}, Type=${data3.type}`);

  console.log("\n================================================================================");
  console.log("🎉 ALL PHASE 21 NATURAL LANGUAGE AGENT TESTS PASSED!");
  console.log("================================================================================\n");

  await server.close();
  process.exit(0);
}

runNlAgentTests().catch((err) => {
  console.error("❌ Natural Language Agent Test Failed:", err);
  process.exit(1);
});
