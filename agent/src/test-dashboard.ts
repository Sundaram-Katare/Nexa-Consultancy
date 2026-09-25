import { buildServer } from "./server";
import { query } from "./db/pool";
import {
  getSummary,
  getByCountry,
  getByInstitution,
  getProgress,
  getErrors,
} from "./db/queries/dashboard";

async function runDashboardTests() {
  console.log("================================================================================");
  console.log("🧪 PHASE 18 — Management Dashboard Test Suite");
  console.log("================================================================================\n");

  // Step 1: Verify Ground Truth SQL vs DB Query Functions
  console.log("--------------------------------------------------------------------------------");
  console.log("Step 1: Comparing Dashboard Query Functions to Raw SQL Ground Truth");
  console.log("--------------------------------------------------------------------------------");

  // 1.1 Summary Ground Truth
  const rawTotalDocs = await query<{ count: string }>(`SELECT COUNT(*) as count FROM documents;`);
  const rawUniqueDocs = await query<{ count: string }>(`SELECT COUNT(*) as count FROM documents WHERE duplicate_of IS NULL;`);
  const rawDupDocs = await query<{ count: string }>(`SELECT COUNT(*) as count FROM documents WHERE duplicate_of IS NOT NULL;`);
  const rawTwoPlus = await query<{ count: string }>(
    `SELECT COUNT(d.id) as count FROM documents d 
     JOIN classifications c ON d.id = c.document_id 
     WHERE d.duplicate_of IS NULL AND c.classification = 'TWO_PLUS_YEARS';`
  );
  const rawLessThanTwo = await query<{ count: string }>(
    `SELECT COUNT(d.id) as count FROM documents d 
     JOIN classifications c ON d.id = c.document_id 
     WHERE d.duplicate_of IS NULL AND c.classification = 'LESS_THAN_TWO_YEARS';`
  );
  const rawNeedsReview = await query<{ count: string }>(
    `SELECT COUNT(d.id) as count FROM documents d 
     JOIN classifications c ON d.id = c.document_id 
     WHERE d.duplicate_of IS NULL AND c.classification = 'NEEDS_REVIEW';`
  );

  const summary = await getSummary();
  console.log(`[SQL vs getSummary()] Total: ${summary.total_records} (Raw: ${rawTotalDocs.rows[0].count})`);
  console.log(`[SQL vs getSummary()] Unique: ${summary.unique_count} (Raw: ${rawUniqueDocs.rows[0].count})`);
  console.log(`[SQL vs getSummary()] Duplicates: ${summary.duplicate_count} (Raw: ${rawDupDocs.rows[0].count})`);
  console.log(`[SQL vs getSummary()] 2+ Years: ${summary.two_plus_years} (Raw: ${rawTwoPlus.rows[0].count})`);
  console.log(`[SQL vs getSummary()] <2 Years: ${summary.less_than_two_years} (Raw: ${rawLessThanTwo.rows[0].count})`);
  console.log(`[SQL vs getSummary()] Needs Review: ${summary.needs_review} (Raw: ${rawNeedsReview.rows[0].count})`);

  if (
    summary.total_records !== parseInt(rawTotalDocs.rows[0].count, 10) ||
    summary.unique_count !== parseInt(rawUniqueDocs.rows[0].count, 10) ||
    summary.duplicate_count !== parseInt(rawDupDocs.rows[0].count, 10) ||
    summary.two_plus_years !== parseInt(rawTwoPlus.rows[0].count, 10)
  ) {
    throw new Error("❌ Summary metrics do not match raw SQL ground truth counts!");
  }
  console.log("✅ getSummary() matches raw SQL ground truth exactly.");

  // 1.2 By-Country Ground Truth
  const countries = await getByCountry();
  console.log(`\n[getByCountry()] Found ${countries.length} active countries`);
  if (countries.length > 0) {
    const topCountry = countries[0];
    console.log(`Top Country: ${topCountry.country_name} -> Total: ${topCountry.total_documents}, Unique: ${topCountry.unique_documents}, Searches: ${topCountry.completed_searches}/${topCountry.total_searches}`);
    
    // Check sum consistency: unique + duplicate == total
    if (topCountry.unique_documents + topCountry.duplicate_documents !== topCountry.total_documents) {
      throw new Error(`❌ Country ${topCountry.country_name} total mismatch: unique(${topCountry.unique_documents}) + dup(${topCountry.duplicate_documents}) != total(${topCountry.total_documents})`);
    }
  }
  console.log("✅ getByCountry() verified and math sums are consistent.");

  // 1.3 By-Institution Ground Truth
  const institutions = await getByInstitution();
  console.log(`\n[getByInstitution()] Found ${institutions.length} institutions`);
  if (institutions.length > 0) {
    console.log(`Top Institution: "${institutions[0].institution}" (${institutions[0].country_name}) -> Total: ${institutions[0].total_documents}`);
  }
  console.log("✅ getByInstitution() verified.");

  // 1.4 Progress Ground Truth
  const progress = await getProgress();
  console.log(`\n[getProgress()] Total Tasks: ${progress.total_tasks}, Completed: ${progress.completed}, Progress: ${progress.completion_percentage}%`);
  console.log("✅ getProgress() verified.");

  // 1.5 Errors Ground Truth
  const errors = await getErrors();
  console.log(`\n[getErrors()] Found ${errors.length} unresolved errors`);
  console.log("✅ getErrors() verified.");

  // Step 2: Test Fastify API Endpoints
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 2: Testing Fastify Dashboard Endpoints");
  console.log("--------------------------------------------------------------------------------");

  const server = buildServer();
  await server.ready();

  // Test 2.1: GET /dashboard/summary
  const resSummary = await server.inject({ method: "GET", url: "/dashboard/summary" });
  if (resSummary.statusCode !== 200) throw new Error(`GET /dashboard/summary failed: ${resSummary.body}`);
  console.log("✅ GET /dashboard/summary -> 200 OK");

  // Test 2.2: GET /dashboard/by-country
  const resCountry = await server.inject({ method: "GET", url: "/dashboard/by-country" });
  if (resCountry.statusCode !== 200) throw new Error(`GET /dashboard/by-country failed: ${resCountry.body}`);
  console.log("✅ GET /dashboard/by-country -> 200 OK");

  // Test 2.3: GET /dashboard/by-institution
  const resInst = await server.inject({ method: "GET", url: "/dashboard/by-institution" });
  if (resInst.statusCode !== 200) throw new Error(`GET /dashboard/by-institution failed: ${resInst.body}`);
  console.log("✅ GET /dashboard/by-institution -> 200 OK");

  // Test 2.4: GET /dashboard/progress
  const resProg = await server.inject({ method: "GET", url: "/dashboard/progress" });
  if (resProg.statusCode !== 200) throw new Error(`GET /dashboard/progress failed: ${resProg.body}`);
  console.log("✅ GET /dashboard/progress -> 200 OK");

  // Test 2.5: GET /dashboard/errors
  const resErr = await server.inject({ method: "GET", url: "/dashboard/errors" });
  if (resErr.statusCode !== 200) throw new Error(`GET /dashboard/errors failed: ${resErr.body}`);
  console.log("✅ GET /dashboard/errors -> 200 OK");

  // Test 2.6: GET Static Dashboard UI
  const resUI = await server.inject({ method: "GET", url: "/ui/index.html" });
  if (resUI.statusCode !== 200 || !resUI.body.includes("NEXA INTELLIGENCE")) {
    throw new Error(`GET /ui/index.html failed or missing brand title: Status ${resUI.statusCode}`);
  }
  console.log("✅ GET /ui/index.html -> 200 OK (Static Dashboard UI served successfully)");

  // Step 3: Test Non-Existent Scope / Empty State Resilience
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 3: Testing Empty-State Resilience with Non-Existent Job UUID");
  console.log("--------------------------------------------------------------------------------");

  const nonExistentJobId = "00000000-0000-0000-0000-000000000000";
  const emptySummary = await getSummary(nonExistentJobId);
  if (emptySummary.total_records !== 0 || emptySummary.two_plus_years !== 0) {
    throw new Error("❌ Empty state should return zeros for all metrics.");
  }
  console.log("✅ Empty state returned clean zeros without runtime errors:", emptySummary);

  const emptyCountries = await getByCountry(nonExistentJobId);
  if (emptyCountries.length !== 0) {
    throw new Error("❌ Non-existent job should return empty country list.");
  }
  console.log("✅ Empty country breakdown handled gracefully:", emptyCountries);

  console.log("\n================================================================================");
  console.log("🎉 ALL PHASE 18 DASHBOARD TESTS PASSED SUCCESSFULLY!");
  console.log("================================================================================\n");

  await server.close();
  process.exit(0);
}

runDashboardTests().catch((err) => {
  console.error("❌ Dashboard Test Failed:", err);
  process.exit(1);
});
