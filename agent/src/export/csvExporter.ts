import {
  getSummary,
  getByCountry,
  getExportDocuments,
  getExportErrors,
} from "../db/queries/exportQueries";

/**
 * Escapes a field value according to RFC 4180 CSV standard.
 */
function escapeCsvValue(val: any): string {
  if (val === null || val === undefined) {
    return '""';
  }
  const str = String(val);
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Converts an array of objects into a formatted CSV string.
 */
function toCsvString(headers: string[], keys: string[], rows: any[]): string {
  const headerLine = headers.map(escapeCsvValue).join(",");
  const dataLines = rows.map((row) =>
    keys.map((key) => escapeCsvValue(row[key])).join(",")
  );
  return [headerLine, ...dataLines].join("\r\n");
}

export type CsvDatasetType =
  | "accepted"
  | "lessThanTwo"
  | "needsReview"
  | "all"
  | "summary"
  | "country"
  | "errors";

/**
 * Generates a clean CSV export for a specific dataset.
 */
export async function generateCsv(
  jobId?: string,
  dataset: CsvDatasetType = "accepted"
): Promise<string> {
  switch (dataset) {
    case "accepted": {
      const rows = await getExportDocuments("TWO_PLUS_YEARS", jobId);
      const headers = [
        "Country",
        "College / University",
        "Document Title",
        "Education Level",
        "Program",
        "Document Type",
        "Duration Text",
        "Completed Years",
        "Classification",
        "Source URL",
        "Source Name",
        "Document ID",
        "Status",
      ];
      const keys = [
        "country",
        "institution",
        "title",
        "education_level",
        "program",
        "document_type",
        "duration_text",
        "completed_years",
        "classification",
        "canonical_url",
        "source_name",
        "document_id",
        "status",
      ];
      return toCsvString(headers, keys, rows);
    }

    case "lessThanTwo": {
      const rows = await getExportDocuments("LESS_THAN_TWO_YEARS", jobId);
      const headers = [
        "Country",
        "College / University",
        "Document Title",
        "Education Level",
        "Program",
        "Document Type",
        "Duration Text",
        "Completed Years",
        "Classification",
        "Source URL",
        "Source Name",
        "Document ID",
        "Status",
      ];
      const keys = [
        "country",
        "institution",
        "title",
        "education_level",
        "program",
        "document_type",
        "duration_text",
        "completed_years",
        "classification",
        "canonical_url",
        "source_name",
        "document_id",
        "status",
      ];
      return toCsvString(headers, keys, rows);
    }

    case "needsReview": {
      const rows = await getExportDocuments("NEEDS_REVIEW", jobId);
      const headers = [
        "Country",
        "College / University",
        "Document Title",
        "Education Level",
        "Program",
        "Document Type",
        "Duration Text",
        "Completed Years",
        "Classification",
        "Review Reasoning",
        "Source URL",
        "Source Name",
        "Document ID",
        "Status",
      ];
      const keys = [
        "country",
        "institution",
        "title",
        "education_level",
        "program",
        "document_type",
        "duration_text",
        "completed_years",
        "classification",
        "reasoning",
        "canonical_url",
        "source_name",
        "document_id",
        "status",
      ];
      return toCsvString(headers, keys, rows);
    }

    case "all": {
      const rows = await getExportDocuments("ALL", jobId);
      const headers = [
        "Country",
        "College / University",
        "Document Title",
        "Education Level",
        "Program",
        "Document Type",
        "Duration Text",
        "Completed Years",
        "Classification",
        "Source URL",
        "Source Name",
        "Document ID",
        "Status",
      ];
      const keys = [
        "country",
        "institution",
        "title",
        "education_level",
        "program",
        "document_type",
        "duration_text",
        "completed_years",
        "classification",
        "canonical_url",
        "source_name",
        "document_id",
        "status",
      ];
      return toCsvString(headers, keys, rows);
    }

    case "summary": {
      const summary = await getSummary(jobId);
      const headers = [
        "Total Records",
        "Unique Documents",
        "Duplicate Documents",
        "2+ Years",
        "< 2 Years",
        "Needs Review",
        "Irrelevant Excluded",
        "Pending Classification",
      ];
      const keys = [
        "total_records",
        "unique_count",
        "duplicate_count",
        "two_plus_years",
        "less_than_two_years",
        "needs_review",
        "irrelevant",
        "pending_classification",
      ];
      return toCsvString(headers, keys, [summary]);
    }

    case "country": {
      const rows = await getByCountry(jobId);
      const headers = [
        "Country Name",
        "Total Documents",
        "Unique Documents",
        "Duplicate Documents",
        "2+ Years",
        "< 2 Years",
        "Needs Review",
        "Irrelevant Excluded",
        "Completed Searches",
        "Total Searches",
      ];
      const keys = [
        "country_name",
        "total_documents",
        "unique_documents",
        "duplicate_documents",
        "two_plus_years",
        "less_than_two_years",
        "needs_review",
        "irrelevant",
        "completed_searches",
        "total_searches",
      ];
      return toCsvString(headers, keys, rows);
    }

    case "errors": {
      const rows = await getExportErrors(jobId);
      const headers = [
        "Error ID",
        "Job ID",
        "Category",
        "Message",
        "Action Required",
        "Retry Count",
        "Resolved",
        "Search Query",
        "Occurred At",
      ];
      const keys = [
        "id",
        "job_id",
        "error_category",
        "message",
        "requires_human_intervention",
        "retry_count",
        "resolved",
        "search_query",
        "occurred_at",
      ];
      return toCsvString(headers, keys, rows);
    }

    default:
      throw new Error(`Unknown dataset type: '${dataset}'`);
  }
}
