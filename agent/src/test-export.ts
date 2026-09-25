import ExcelJS from "exceljs";
import { buildServer } from "./server";
import { query } from "./db/pool";
import { generateXlsx } from "./export/xlsxExporter";
import { generateCsv } from "./export/csvExporter";
import { getSummary } from "./db/queries/dashboard";

async function runExportTests() {
  console.log("================================================================================");
  console.log("🧪 PHASE 19 — Multi-Sheet XLSX and CSV Export Test Suite");
  console.log("================================================================================\n");

  // Step 1: Test Direct XLSX Generation & Multi-Sheet Structure
  console.log("--------------------------------------------------------------------------------");
  console.log("Step 1: Validating Multi-Sheet XLSX Structure & Content Consistency");
  console.log("--------------------------------------------------------------------------------");

  const xlsxBuffer = await generateXlsx();
  if (!xlsxBuffer || xlsxBuffer.length === 0) {
    throw new Error("❌ generateXlsx() returned an empty buffer!");
  }
  console.log(`✅ generateXlsx() generated valid buffer of size ${xlsxBuffer.length} bytes`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsxBuffer);

  const expectedSheets = [
    "Summary",
    "Accepted_2Plus",
    "Less_Than_2",
    "Needs_Review",
    "By_Country",
    "By_Institution",
    "Duplicates",
    "Errors",
    "Search_Progress",
  ];

  const actualSheetNames = workbook.worksheets.map((w) => w.name);
  console.log(`Discovered Worksheets (${actualSheetNames.length}): ${actualSheetNames.join(", ")}`);

  for (const sheetName of expectedSheets) {
    const ws = workbook.getWorksheet(sheetName);
    if (!ws) {
      throw new Error(`❌ Missing required worksheet: "${sheetName}"`);
    }

    // Confirm frozen top header row
    const views = ws.views || [];
    const isFrozen = views.some((v: any) => v.state === "frozen" && v.ySplit === 1);
    if (!isFrozen) {
      throw new Error(`❌ Worksheet "${sheetName}" is not configured with frozen top header row.`);
    }

    // Confirm bold header
    const headerRow = ws.getRow(1);
    if (!headerRow.font?.bold) {
      throw new Error(`❌ Worksheet "${sheetName}" header row is not bold.`);
    }

    console.log(`✅ [Sheet Verified] "${sheetName}": ${ws.rowCount} rows, ${ws.columnCount} columns (Frozen & Styled)`);
  }

  // Cross-check Summary Sheet numbers with Dashboard Summary ground truth
  const summarySheet = workbook.getWorksheet("Summary")!;
  const summaryRow = summarySheet.getRow(2);
  const totalInSheet = Number(summaryRow.getCell(1).value);
  const uniqueInSheet = Number(summaryRow.getCell(2).value);
  const twoPlusInSheet = Number(summaryRow.getCell(4).value);

  const groundTruthSummary = await getSummary();
  console.log(`\n[Cross-Check Summary Sheet vs Live DB Summary]`);
  console.log(`Total Records: Sheet=${totalInSheet} vs DB=${groundTruthSummary.total_records}`);
  console.log(`Unique Records: Sheet=${uniqueInSheet} vs DB=${groundTruthSummary.unique_count}`);
  console.log(`2+ Years Target: Sheet=${twoPlusInSheet} vs DB=${groundTruthSummary.two_plus_years}`);

  if (
    totalInSheet !== groundTruthSummary.total_records ||
    uniqueInSheet !== groundTruthSummary.unique_count ||
    twoPlusInSheet !== groundTruthSummary.two_plus_years
  ) {
    throw new Error("❌ Summary sheet values do not match live DB summary ground truth!");
  }
  console.log("✅ Summary sheet numbers match dashboard ground truth exactly.");

  // Step 2: Validate CSV Exporter Outputs
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 2: Testing CSV Exporter Datasets");
  console.log("--------------------------------------------------------------------------------");

  const datasets: Array<"accepted" | "lessThanTwo" | "needsReview" | "all" | "summary" | "country" | "errors"> = [
    "accepted",
    "lessThanTwo",
    "needsReview",
    "all",
    "summary",
    "country",
    "errors",
  ];

  for (const ds of datasets) {
    const csvContent = await generateCsv(undefined, ds);
    if (!csvContent || csvContent.trim().length === 0) {
      throw new Error(`❌ generateCsv("${ds}") returned empty string!`);
    }
    const lines = csvContent.split("\r\n");
    console.log(`✅ [CSV Dataset: "${ds}"] Header: ${lines[0].substring(0, 60)}... (${lines.length - 1} data rows)`);
  }

  // Step 3: Test Fastify Export Endpoints & Headers
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 3: Testing Fastify Export Endpoints, Headers, and Content-Disposition");
  console.log("--------------------------------------------------------------------------------");

  const server = buildServer();
  await server.ready();

  // Pick or create a test job
  const jobRes = await query<{ id: string }>(`SELECT id FROM jobs ORDER BY created_at DESC LIMIT 1;`);
  const testJobId = jobRes.rows[0]?.id;

  // 3.1 Test GET /jobs/:id/export?format=xlsx
  const xlsxEndpointRes = await server.inject({
    method: "GET",
    url: `/jobs/${testJobId}/export?format=xlsx`,
  });

  if (xlsxEndpointRes.statusCode !== 200) {
    throw new Error(`❌ GET /jobs/:id/export?format=xlsx failed: Status ${xlsxEndpointRes.statusCode}`);
  }
  const xlsxContentType = xlsxEndpointRes.headers["content-type"];
  const xlsxDisposition = xlsxEndpointRes.headers["content-disposition"];
  if (
    xlsxContentType !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    !xlsxDisposition?.includes("attachment; filename=") ||
    !xlsxDisposition?.endsWith('.xlsx"')
  ) {
    throw new Error(`❌ Invalid XLSX headers: Content-Type=${xlsxContentType}, Content-Disposition=${xlsxDisposition}`);
  }
  console.log(`✅ GET /jobs/:id/export?format=xlsx -> 200 OK (${xlsxEndpointRes.rawPayload.length} bytes)`);
  console.log(`   Content-Type: ${xlsxContentType}`);
  console.log(`   Content-Disposition: ${xlsxDisposition}`);

  // 3.2 Test GET /jobs/:id/export?format=csv&dataset=accepted
  const csvEndpointRes = await server.inject({
    method: "GET",
    url: `/jobs/${testJobId}/export?format=csv&dataset=accepted`,
  });

  if (csvEndpointRes.statusCode !== 200) {
    throw new Error(`❌ GET /jobs/:id/export?format=csv failed: Status ${csvEndpointRes.statusCode}`);
  }
  const csvContentType = csvEndpointRes.headers["content-type"];
  const csvDisposition = csvEndpointRes.headers["content-disposition"];
  if (
    !csvContentType?.includes("text/csv") ||
    !csvDisposition?.includes("attachment; filename=") ||
    !csvDisposition?.endsWith('.csv"')
  ) {
    throw new Error(`❌ Invalid CSV headers: Content-Type=${csvContentType}, Content-Disposition=${csvDisposition}`);
  }
  console.log(`✅ GET /jobs/:id/export?format=csv -> 200 OK (${csvEndpointRes.body.length} chars)`);
  console.log(`   Content-Type: ${csvContentType}`);
  console.log(`   Content-Disposition: ${csvDisposition}`);

  // 3.3 Test POST /jobs/:id/export (n8n Webhook Target)
  const postExportRes = await server.inject({
    method: "POST",
    url: `/jobs/${testJobId}/export`,
    payload: { format: "xlsx" },
  });

  if (postExportRes.statusCode !== 200) {
    throw new Error(`❌ POST /jobs/:id/export failed: Status ${postExportRes.statusCode}`);
  }
  console.log(`✅ POST /jobs/:id/export (n8n Webhook Call) -> 200 OK`);

  // 3.4 Test Global GET /export
  const globalExportRes = await server.inject({
    method: "GET",
    url: "/export?format=xlsx",
  });
  if (globalExportRes.statusCode !== 200) {
    throw new Error(`❌ GET /export failed: Status ${globalExportRes.statusCode}`);
  }
  console.log(`✅ GET /export (Global Export) -> 200 OK`);

  // Step 4: Test Empty Dataset Resilience
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Step 4: Testing Empty Dataset Resilience on Non-Existent Job ID");
  console.log("--------------------------------------------------------------------------------");

  const nonExistentJob = "00000000-0000-0000-0000-000000000000";
  const emptyXlsx = await generateXlsx(nonExistentJob);
  const emptyWorkbook = new ExcelJS.Workbook();
  await emptyWorkbook.xlsx.load(emptyXlsx);
  if (emptyWorkbook.worksheets.length !== 9) {
    throw new Error("❌ Empty export should still generate all 9 sheets with headers!");
  }
  console.log(`✅ Empty job export successfully generated all 9 sheets with zero errors.`);

  console.log("\n================================================================================");
  console.log("🎉 ALL PHASE 19 EXPORT TESTS PASSED SUCCESSFULLY!");
  console.log("================================================================================\n");

  await server.close();
  process.exit(0);
}

runExportTests().catch((err) => {
  console.error("❌ Export Test Failed:", err);
  process.exit(1);
});
