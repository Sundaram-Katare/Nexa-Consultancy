import { query } from "../pool";
import {
  getSummary,
  getByCountry,
  getByInstitution,
  SummaryMetrics,
  CountryMetrics,
  InstitutionMetrics,
} from "./dashboard";

export { getSummary, getByCountry, getByInstitution, SummaryMetrics, CountryMetrics, InstitutionMetrics };

export interface ExportDocumentRow {
  country: string;
  institution: string;
  title: string;
  education_level: string;
  program: string;
  document_type: string;
  duration_text: string;
  completed_years: number | null;
  classification: string;
  canonical_url: string;
  source_name: string;
  document_id: string;
  status: string;
  reasoning?: string;
}

export interface ExportDuplicateRow {
  document_id: string;
  title: string;
  country: string;
  institution: string;
  duplicate_of_id: string;
  duplicate_of_title: string;
  duplicate_reason: string;
  confidence: number;
  canonical_url: string;
}

export interface ExportErrorRow {
  id: string;
  job_id: string;
  error_category: string;
  message: string;
  requires_human_intervention: boolean;
  retry_count: number;
  resolved: boolean;
  search_query: string;
  occurred_at: string;
}

export interface ExportSearchTaskRow {
  task_id: string;
  job_id: string;
  query_text: string;
  country_name: string;
  source_name: string;
  status: string;
  page: number;
  created_at: string;
  updated_at: string;
}

/**
 * Helper to build the document scope SQL filter if jobId is supplied.
 */
function buildJobScopeFilter(jobId?: string, paramStartIndex: number = 1): { filterSql: string; params: any[] } {
  if (!jobId) {
    return { filterSql: "", params: [] };
  }
  return {
    filterSql: `AND d.id IN (
      SELECT d2.id FROM documents d2
      JOIN search_tasks st ON d2.country_id = st.country_id
      WHERE st.job_id = $${paramStartIndex}
    )`,
    params: [jobId],
  };
}

/**
 * Retrieves documents filtered by classification category (or ALL).
 */
export async function getExportDocuments(
  classification?: "TWO_PLUS_YEARS" | "LESS_THAN_TWO_YEARS" | "NEEDS_REVIEW" | "ALL",
  jobId?: string
): Promise<ExportDocumentRow[]> {
  const params: any[] = [];
  let classificationFilter = "";

  if (classification && classification !== "ALL") {
    params.push(classification);
    classificationFilter = `AND c.classification = $${params.length}`;
  }

  const { filterSql, params: scopeParams } = buildJobScopeFilter(jobId, params.length + 1);
  params.push(...scopeParams);

  const queryText = `
    SELECT 
      COALESCE(co.name, 'Unknown') as country,
      COALESCE(d.institution, 'Unknown / Not Stated') as institution,
      COALESCE(d.title, 'Untitled Document') as title,
      COALESCE(d.education_level, 'N/A') as education_level,
      COALESCE(d.program, 'N/A') as program,
      COALESCE(d.document_type, 'Transcript') as document_type,
      COALESCE(c.duration_text, CASE WHEN c.completed_years IS NOT NULL THEN c.completed_years || ' Years' ELSE 'Not Specified' END) as duration_text,
      c.completed_years,
      COALESCE(c.classification, 'PENDING_CLASSIFICATION') as classification,
      d.canonical_url,
      COALESCE(s.name, 'slideshare') as source_name,
      d.id as document_id,
      d.status,
      c.reasoning
    FROM documents d
    JOIN sources s ON d.source_id = s.id
    LEFT JOIN countries co ON d.country_id = co.id
    LEFT JOIN classifications c ON d.id = c.document_id
    WHERE d.duplicate_of IS NULL 
      AND d.status != 'IRRELEVANT'
      ${classificationFilter}
      ${filterSql}
    ORDER BY co.name ASC, d.created_at DESC;
  `;

  const res = await query<ExportDocumentRow>(queryText, params);
  return res.rows;
}

/**
 * Retrieves all soft duplicate documents flagged during ingestion.
 */
export async function getExportDuplicates(jobId?: string): Promise<ExportDuplicateRow[]> {
  const params: any[] = [];
  const { filterSql, params: scopeParams } = buildJobScopeFilter(jobId, 1);
  params.push(...scopeParams);

  const queryText = `
    SELECT 
      d.id as document_id,
      COALESCE(d.title, 'Untitled') as title,
      COALESCE(co.name, 'Unknown') as country,
      COALESCE(d.institution, 'N/A') as institution,
      d.duplicate_of as duplicate_of_id,
      COALESCE(orig.title, 'Original Record') as duplicate_of_title,
      COALESCE(d.duplicate_reason, 'Fuzzy title/institution similarity match') as duplicate_reason,
      COALESCE(d.duplicate_confidence, 0.85)::float as confidence,
      d.canonical_url
    FROM documents d
    LEFT JOIN documents orig ON d.duplicate_of = orig.id
    LEFT JOIN countries co ON d.country_id = co.id
    WHERE d.duplicate_of IS NOT NULL
      ${filterSql}
    ORDER BY d.created_at DESC;
  `;

  const res = await query<ExportDuplicateRow>(queryText, params);
  return res.rows;
}

/**
 * Retrieves error history across the job.
 */
export async function getExportErrors(jobId?: string): Promise<ExportErrorRow[]> {
  const params: any[] = [];
  let filter = "";

  if (jobId) {
    params.push(jobId);
    filter = `WHERE e.job_id = $1`;
  }

  const queryText = `
    SELECT 
      e.id,
      COALESCE(e.job_id::text, 'N/A') as job_id,
      e.error_category,
      e.message,
      COALESCE(e.requires_human_intervention, false) as requires_human_intervention,
      COALESCE(e.retry_count, 0) as retry_count,
      COALESCE(e.resolved, false) as resolved,
      COALESCE(st.query_text, 'N/A') as search_query,
      e.occurred_at::text
    FROM errors e
    LEFT JOIN search_tasks st ON e.search_task_id = st.id
    ${filter}
    ORDER BY e.occurred_at DESC;
  `;

  const res = await query<ExportErrorRow>(queryText, params);
  return res.rows;
}

/**
 * Retrieves granular search tasks progress for verification.
 */
export async function getExportSearchTasks(jobId?: string): Promise<ExportSearchTaskRow[]> {
  const params: any[] = [];
  let filter = "";

  if (jobId) {
    params.push(jobId);
    filter = `WHERE st.job_id = $1`;
  }

  const queryText = `
    SELECT 
      st.id as task_id,
      st.job_id::text,
      st.query_text,
      COALESCE(co.name, 'Global') as country_name,
      COALESCE(s.name, 'slideshare') as source_name,
      st.status,
      COALESCE(st.page, 1) as page,
      st.created_at::text,
      st.updated_at::text
    FROM search_tasks st
    LEFT JOIN countries co ON st.country_id = co.id
    LEFT JOIN sources s ON st.source_id = s.id
    ${filter}
    ORDER BY st.created_at ASC, st.page ASC;
  `;

  const res = await query<ExportSearchTaskRow>(queryText, params);
  return res.rows;
}
