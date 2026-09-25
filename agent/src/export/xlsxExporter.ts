import ExcelJS from "exceljs";
import {
  getSummary,
  getByCountry,
  getByInstitution,
  getExportDocuments,
  getExportDuplicates,
  getExportErrors,
  getExportSearchTasks,
} from "../db/queries/exportQueries";

/**
 * Applies standard header styling, freezing, and column width formatting to a worksheet.
 */
function styleWorksheet(worksheet: ExcelJS.Worksheet) {
  // 1. Freeze top header row
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  // 2. Style header row (Row 1)
  const headerRow = worksheet.getRow(1);
  headerRow.height = 24;
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" }, // Slate-800
  };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };

  // 3. Auto-fit column widths with padding
  worksheet.columns.forEach((column) => {
    let maxLength = 12;
    if (column.header) {
      maxLength = Math.max(maxLength, column.header.toString().length);
    }
    column.eachCell?.({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber > 1 && cell.value) {
        const strVal = cell.value.toString();
        maxLength = Math.max(maxLength, Math.min(strVal.length, 60));
      }
    });
    column.width = Math.min(Math.max(maxLength + 4, 14), 70);
  });
}

/**
 * Translates machine reason codes into clear human-readable sentences for human reviewers.
 */
function humanizeReasoning(rawReason?: string): string {
  if (!rawReason) {
    return "Missing duration evidence; manual document review required.";
  }
  const clean = rawReason.trim();
  if (clean === "no_evidence_found" || clean.includes("no evidence")) {
    return "No explicit academic duration or graduation date patterns found in document text.";
  }
  if (clean === "conflicting_signals" || clean.includes("conflict")) {
    return "Conflicting duration signals detected (multiple contradictory year or semester counts).";
  }
  if (clean === "semester_only" || clean.includes("semester")) {
    return "Semester count detected without confirmation of academic years or completion.";
  }
  return clean;
}

/**
 * Generates the complete 9-sheet management XLSX workbook buffer.
 */
export async function generateXlsx(jobId?: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Nexa Intelligence Agent Engine";
  workbook.lastModifiedBy = "Nexa Intelligence";
  workbook.created = new Date();
  workbook.modified = new Date();

  // -------------------------------------------------------------
  // Sheet 1: Summary
  // -------------------------------------------------------------
  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Total Records Found", key: "total_records" },
    { header: "Unique Documents", key: "unique_count" },
    { header: "Duplicate Documents", key: "duplicate_count" },
    { header: "2+ Years (Accepted)", key: "two_plus_years" },
    { header: "< 2 Years", key: "less_than_two_years" },
    { header: "Needs Human Review", key: "needs_review" },
    { header: "Irrelevant (Excluded)", key: "irrelevant" },
    { header: "Pending Classification", key: "pending_classification" },
  ];

  const summaryData = await getSummary(jobId);
  summarySheet.addRow(summaryData);
  styleWorksheet(summarySheet);

  // -------------------------------------------------------------
  // Sheet 2: Accepted_2Plus
  // -------------------------------------------------------------
  const acceptedSheet = workbook.addWorksheet("Accepted_2Plus");
  acceptedSheet.columns = [
    { header: "Country", key: "country" },
    { header: "College / University", key: "institution" },
    { header: "Document Title", key: "title" },
    { header: "Education Level", key: "education_level" },
    { header: "Program", key: "program" },
    { header: "Document Type", key: "document_type" },
    { header: "Academic Duration / Years Completed", key: "duration_text" },
    { header: "Classification", key: "classification" },
    { header: "Document Link (Source URL)", key: "canonical_url" },
    { header: "Source Name", key: "source_name" },
    { header: "Document ID", key: "document_id" },
    { header: "Status", key: "status" },
  ];

  const acceptedDocs = await getExportDocuments("TWO_PLUS_YEARS", jobId);
  acceptedDocs.forEach((doc) => acceptedSheet.addRow(doc));
  styleWorksheet(acceptedSheet);

  // -------------------------------------------------------------
  // Sheet 3: Less_Than_2
  // -------------------------------------------------------------
  const lessThanTwoSheet = workbook.addWorksheet("Less_Than_2");
  lessThanTwoSheet.columns = [
    { header: "Country", key: "country" },
    { header: "College / University", key: "institution" },
    { header: "Document Title", key: "title" },
    { header: "Education Level", key: "education_level" },
    { header: "Program", key: "program" },
    { header: "Document Type", key: "document_type" },
    { header: "Academic Duration / Years Completed", key: "duration_text" },
    { header: "Classification", key: "classification" },
    { header: "Document Link (Source URL)", key: "canonical_url" },
    { header: "Source Name", key: "source_name" },
    { header: "Document ID", key: "document_id" },
    { header: "Status", key: "status" },
  ];

  const lessThanTwoDocs = await getExportDocuments("LESS_THAN_TWO_YEARS", jobId);
  lessThanTwoDocs.forEach((doc) => lessThanTwoSheet.addRow(doc));
  styleWorksheet(lessThanTwoSheet);

  // -------------------------------------------------------------
  // Sheet 4: Needs_Review
  // -------------------------------------------------------------
  const needsReviewSheet = workbook.addWorksheet("Needs_Review");
  needsReviewSheet.columns = [
    { header: "Country", key: "country" },
    { header: "College / University", key: "institution" },
    { header: "Document Title", key: "title" },
    { header: "Education Level", key: "education_level" },
    { header: "Program", key: "program" },
    { header: "Document Type", key: "document_type" },
    { header: "Academic Duration / Years Completed", key: "duration_text" },
    { header: "Classification", key: "classification" },
    { header: "Review Reasoning / Why Flagged", key: "reasoning" },
    { header: "Document Link (Source URL)", key: "canonical_url" },
    { header: "Source Name", key: "source_name" },
    { header: "Document ID", key: "document_id" },
    { header: "Status", key: "status" },
  ];

  const needsReviewDocs = await getExportDocuments("NEEDS_REVIEW", jobId);
  needsReviewDocs.forEach((doc) =>
    needsReviewSheet.addRow({
      ...doc,
      reasoning: humanizeReasoning(doc.reasoning),
    })
  );
  styleWorksheet(needsReviewSheet);

  // -------------------------------------------------------------
  // Sheet 5: By_Country
  // -------------------------------------------------------------
  const countrySheet = workbook.addWorksheet("By_Country");
  countrySheet.columns = [
    { header: "Country Name", key: "country_name" },
    { header: "Total Documents", key: "total_documents" },
    { header: "Unique Documents", key: "unique_documents" },
    { header: "Duplicate Documents", key: "duplicate_documents" },
    { header: "2+ Years", key: "two_plus_years" },
    { header: "< 2 Years", key: "less_than_two_years" },
    { header: "Needs Review", key: "needs_review" },
    { header: "Irrelevant Excluded", key: "irrelevant" },
    { header: "Completed Searches", key: "completed_searches" },
    { header: "Total Searches", key: "total_searches" },
  ];

  const countryData = await getByCountry(jobId);
  countryData.forEach((c) => countrySheet.addRow(c));
  styleWorksheet(countrySheet);

  // -------------------------------------------------------------
  // Sheet 6: By_Institution
  // -------------------------------------------------------------
  const institutionSheet = workbook.addWorksheet("By_Institution");
  institutionSheet.columns = [
    { header: "Institution Name", key: "institution" },
    { header: "Country Name", key: "country_name" },
    { header: "Total Documents", key: "total_documents" },
    { header: "Unique Documents", key: "unique_documents" },
    { header: "Duplicate Documents", key: "duplicate_documents" },
    { header: "2+ Years", key: "two_plus_years" },
    { header: "< 2 Years", key: "less_than_two_years" },
    { header: "Needs Review", key: "needs_review" },
  ];

  const institutionData = await getByInstitution(jobId);
  institutionData.forEach((i) => institutionSheet.addRow(i));
  styleWorksheet(institutionSheet);

  // -------------------------------------------------------------
  // Sheet 7: Duplicates
  // -------------------------------------------------------------
  const duplicatesSheet = workbook.addWorksheet("Duplicates");
  duplicatesSheet.columns = [
    { header: "Duplicate Document ID", key: "document_id" },
    { header: "Document Title", key: "title" },
    { header: "Country", key: "country" },
    { header: "Institution", key: "institution" },
    { header: "Duplicate Of (Original ID)", key: "duplicate_of_id" },
    { header: "Original Title", key: "duplicate_of_title" },
    { header: "Dedup Match Reason", key: "duplicate_reason" },
    { header: "Confidence Score", key: "confidence" },
    { header: "Canonical URL", key: "canonical_url" },
  ];

  const duplicatesData = await getExportDuplicates(jobId);
  duplicatesData.forEach((d) => duplicatesSheet.addRow(d));
  styleWorksheet(duplicatesSheet);

  // -------------------------------------------------------------
  // Sheet 8: Errors
  // -------------------------------------------------------------
  const errorsSheet = workbook.addWorksheet("Errors");
  errorsSheet.columns = [
    { header: "Error ID", key: "id" },
    { header: "Job ID", key: "job_id" },
    { header: "Category", key: "error_category" },
    { header: "Error Message", key: "message" },
    { header: "Human Intervention Required", key: "requires_human_intervention" },
    { header: "Retry Count", key: "retry_count" },
    { header: "Resolved", key: "resolved" },
    { header: "Search Query Context", key: "search_query" },
    { header: "Occurred At", key: "occurred_at" },
  ];

  const errorsData = await getExportErrors(jobId);
  errorsData.forEach((e) =>
    errorsSheet.addRow({
      ...e,
      requires_human_intervention: e.requires_human_intervention ? "YES" : "NO",
      resolved: e.resolved ? "YES" : "NO",
    })
  );
  styleWorksheet(errorsSheet);

  // -------------------------------------------------------------
  // Sheet 9: Search_Progress
  // -------------------------------------------------------------
  const searchProgressSheet = workbook.addWorksheet("Search_Progress");
  searchProgressSheet.columns = [
    { header: "Task ID", key: "task_id" },
    { header: "Job ID", key: "job_id" },
    { header: "Search Query", key: "query_text" },
    { header: "Country", key: "country_name" },
    { header: "Source", key: "source_name" },
    { header: "Status", key: "status" },
    { header: "Last Page Reached", key: "page" },
    { header: "Created At", key: "created_at" },
    { header: "Updated At", key: "updated_at" },
  ];

  const searchTasksData = await getExportSearchTasks(jobId);
  searchTasksData.forEach((st) => searchProgressSheet.addRow(st));
  styleWorksheet(searchProgressSheet);

  const uint8Buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(uint8Buffer);
}
