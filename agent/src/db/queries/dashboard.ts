import { query } from "../pool";

export interface SummaryMetrics {
  total_records: number;
  unique_count: number;
  duplicate_count: number;
  two_plus_years: number;
  less_than_two_years: number;
  needs_review: number;
  irrelevant: number;
  pending_classification: number;
}

export interface CountryMetrics {
  country_id: number;
  country_name: string;
  total_documents: number;
  unique_documents: number;
  duplicate_documents: number;
  two_plus_years: number;
  less_than_two_years: number;
  needs_review: number;
  irrelevant: number;
  pending: number;
  total_searches: number;
  completed_searches: number;
  remaining_searches: number;
}

export interface InstitutionMetrics {
  institution: string;
  country_name: string;
  country_id: number | null;
  total_documents: number;
  unique_documents: number;
  duplicate_documents: number;
  two_plus_years: number;
  less_than_two_years: number;
  needs_review: number;
  irrelevant: number;
}

export interface ProgressMetrics {
  job_id: string | null;
  total_tasks: number;
  queued: number;
  running: number;
  completed: number;
  blocked: number;
  failed: number;
  completion_percentage: number;
  jobs?: Array<{
    id: string;
    status: string;
    created_at: string;
    total_tasks: number;
    completed_tasks: number;
    completion_percentage: number;
  }>;
}

export interface ErrorDetail {
  id: string;
  job_id: string | null;
  job_status: string | null;
  search_task_id: string | null;
  search_query: string | null;
  document_id: string | null;
  error_category: string;
  message: string;
  retry_count: number;
  requires_human_intervention: boolean;
  details: any;
  occurred_at: string;
}

/**
 * Retrieves aggregate summary metrics across all documents or filtered by Job ID.
 */
export async function getSummary(jobId?: string): Promise<SummaryMetrics> {
  let docFilter = "";
  const params: any[] = [];

  if (jobId) {
    params.push(jobId);
    docFilter = `WHERE d.id IN (
      SELECT d2.id FROM documents d2
      JOIN search_tasks st ON d2.country_id = st.country_id
      WHERE st.job_id = $1
    )`;
  }

  const queryText = `
    SELECT 
      COUNT(d.id)::int as total_records,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL)::int as unique_count,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NOT NULL)::int as duplicate_count,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND c.classification = 'TWO_PLUS_YEARS')::int as two_plus_years,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND c.classification = 'LESS_THAN_TWO_YEARS')::int as less_than_two_years,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND c.classification = 'NEEDS_REVIEW')::int as needs_review,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND d.status = 'IRRELEVANT')::int as irrelevant,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND c.id IS NULL AND d.status != 'IRRELEVANT')::int as pending_classification
    FROM documents d
    LEFT JOIN classifications c ON d.id = c.document_id
    ${docFilter};
  `;

  const res = await query<SummaryMetrics>(queryText, params);
  const row = res.rows[0];

  return {
    total_records: row?.total_records ?? 0,
    unique_count: row?.unique_count ?? 0,
    duplicate_count: row?.duplicate_count ?? 0,
    two_plus_years: row?.two_plus_years ?? 0,
    less_than_two_years: row?.less_than_two_years ?? 0,
    needs_review: row?.needs_review ?? 0,
    irrelevant: row?.irrelevant ?? 0,
    pending_classification: row?.pending_classification ?? 0,
  };
}

/**
 * Retrieves per-country metrics including document counts, classifications, and search progress.
 */
export async function getByCountry(jobId?: string): Promise<CountryMetrics[]> {
  const params: any[] = [];
  let jobFilterTasks = "";
  let jobFilterDocs = "";

  if (jobId) {
    params.push(jobId);
    jobFilterTasks = `AND st.job_id = $1`;
    jobFilterDocs = `AND d.id IN (
      SELECT d2.id FROM documents d2
      JOIN search_tasks st ON d2.country_id = st.country_id
      WHERE st.job_id = $1
    )`;
  }

  const queryText = `
    WITH search_metrics AS (
      SELECT 
        st.country_id,
        COUNT(*)::int as total_searches,
        COUNT(*) FILTER (WHERE st.status = 'COMPLETED')::int as completed_searches,
        COUNT(*) FILTER (WHERE st.status IN ('QUEUED', 'RUNNING', 'BLOCKED', 'PAUSED'))::int as remaining_searches
      FROM search_tasks st
      WHERE st.country_id IS NOT NULL ${jobFilterTasks}
      GROUP BY st.country_id
    ),
    doc_metrics AS (
      SELECT 
        d.country_id,
        COUNT(d.id)::int as total_documents,
        COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL)::int as unique_documents,
        COUNT(d.id) FILTER (WHERE d.duplicate_of IS NOT NULL)::int as duplicate_documents,
        COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND c.classification = 'TWO_PLUS_YEARS')::int as two_plus_years,
        COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND c.classification = 'LESS_THAN_TWO_YEARS')::int as less_than_two_years,
        COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND c.classification = 'NEEDS_REVIEW')::int as needs_review,
        COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND d.status = 'IRRELEVANT')::int as irrelevant,
        COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND c.id IS NULL AND d.status != 'IRRELEVANT')::int as pending
      FROM documents d
      LEFT JOIN classifications c ON d.id = c.document_id
      WHERE d.country_id IS NOT NULL ${jobFilterDocs}
      GROUP BY d.country_id
    )
    SELECT 
      co.id as country_id,
      co.name as country_name,
      COALESCE(dm.total_documents, 0)::int as total_documents,
      COALESCE(dm.unique_documents, 0)::int as unique_documents,
      COALESCE(dm.duplicate_documents, 0)::int as duplicate_documents,
      COALESCE(dm.two_plus_years, 0)::int as two_plus_years,
      COALESCE(dm.less_than_two_years, 0)::int as less_than_two_years,
      COALESCE(dm.needs_review, 0)::int as needs_review,
      COALESCE(dm.irrelevant, 0)::int as irrelevant,
      COALESCE(dm.pending, 0)::int as pending,
      COALESCE(sm.total_searches, 0)::int as total_searches,
      COALESCE(sm.completed_searches, 0)::int as completed_searches,
      COALESCE(sm.remaining_searches, 0)::int as remaining_searches
    FROM countries co
    LEFT JOIN doc_metrics dm ON co.id = dm.country_id
    LEFT JOIN search_metrics sm ON co.id = sm.country_id
    WHERE co.is_accepted = true 
      AND (dm.total_documents > 0 OR sm.total_searches > 0)
    ORDER BY total_documents DESC, country_name ASC;
  `;

  const res = await query<CountryMetrics>(queryText, params);
  return res.rows;
}

/**
 * Retrieves per-institution document classification metrics.
 */
export async function getByInstitution(
  jobId?: string,
  countryId?: number
): Promise<InstitutionMetrics[]> {
  const params: any[] = [];
  let whereClauses = ["d.institution IS NOT NULL", "TRIM(d.institution) != ''"];

  if (countryId) {
    params.push(countryId);
    whereClauses.push(`d.country_id = $${params.length}`);
  }

  if (jobId) {
    params.push(jobId);
    whereClauses.push(`d.id IN (
      SELECT d2.id FROM documents d2
      JOIN search_tasks st ON d2.country_id = st.country_id
      WHERE st.job_id = $${params.length}
    )`);
  }

  const queryText = `
    SELECT 
      d.institution,
      COALESCE(co.name, 'Unknown') as country_name,
      d.country_id,
      COUNT(d.id)::int as total_documents,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL)::int as unique_documents,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NOT NULL)::int as duplicate_documents,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND c.classification = 'TWO_PLUS_YEARS')::int as two_plus_years,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND c.classification = 'LESS_THAN_TWO_YEARS')::int as less_than_two_years,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND c.classification = 'NEEDS_REVIEW')::int as needs_review,
      COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL AND d.status = 'IRRELEVANT')::int as irrelevant
    FROM documents d
    LEFT JOIN countries co ON d.country_id = co.id
    LEFT JOIN classifications c ON d.id = c.document_id
    WHERE ${whereClauses.join(" AND ")}
    GROUP BY d.institution, co.name, d.country_id
    ORDER BY total_documents DESC, d.institution ASC
    LIMIT 100;
  `;

  const res = await query<InstitutionMetrics>(queryText, params);
  return res.rows;
}

/**
 * Retrieves search tasks and job progress rollup.
 */
export async function getProgress(jobId?: string): Promise<ProgressMetrics> {
  const params: any[] = [];
  let taskFilter = "";

  if (jobId) {
    params.push(jobId);
    taskFilter = `WHERE job_id = $1`;
  }

  const queryText = `
    SELECT 
      COUNT(*)::int as total_tasks,
      COUNT(*) FILTER (WHERE status = 'QUEUED')::int as queued,
      COUNT(*) FILTER (WHERE status = 'RUNNING')::int as running,
      COUNT(*) FILTER (WHERE status = 'COMPLETED')::int as completed,
      COUNT(*) FILTER (WHERE status = 'BLOCKED')::int as blocked,
      COUNT(*) FILTER (WHERE status = 'FAILED')::int as failed
    FROM search_tasks
    ${taskFilter};
  `;

  const res = await query<{
    total_tasks: number;
    queued: number;
    running: number;
    completed: number;
    blocked: number;
    failed: number;
  }>(queryText, params);

  const row = res.rows[0];
  const total = row?.total_tasks || 0;
  const completed = row?.completed || 0;
  const percentage = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

  let jobsList: any[] | undefined = undefined;

  if (!jobId) {
    const jobsRes = await query<{
      id: string;
      status: string;
      created_at: string;
      total_tasks: number;
      completed_tasks: number;
    }>(`
      SELECT 
        j.id,
        j.status,
        j.created_at,
        COUNT(st.id)::int as total_tasks,
        COUNT(st.id) FILTER (WHERE st.status = 'COMPLETED')::int as completed_tasks
      FROM jobs j
      LEFT JOIN search_tasks st ON j.id = st.job_id
      GROUP BY j.id
      ORDER BY j.created_at DESC
      LIMIT 20;
    `);

    jobsList = jobsRes.rows.map((j) => ({
      id: j.id,
      status: j.status,
      created_at: j.created_at,
      total_tasks: j.total_tasks,
      completed_tasks: j.completed_tasks,
      completion_percentage:
        j.total_tasks > 0
          ? Math.round((j.completed_tasks / j.total_tasks) * 1000) / 10
          : 0,
    }));
  }

  return {
    job_id: jobId || null,
    total_tasks: total,
    queued: row?.queued || 0,
    running: row?.running || 0,
    completed: completed,
    blocked: row?.blocked || 0,
    failed: row?.failed || 0,
    completion_percentage: percentage,
    jobs: jobsList,
  };
}

/**
 * Retrieves unresolved error logs with full context.
 */
export async function getErrors(
  jobId?: string,
  limit: number = 50
): Promise<ErrorDetail[]> {
  const params: any[] = [];
  let filter = `WHERE COALESCE(e.resolved, false) = false`;

  if (jobId) {
    params.push(jobId);
    filter += ` AND e.job_id = $${params.length}`;
  }

  params.push(limit);
  const limitParam = `$${params.length}`;

  const queryText = `
    SELECT 
      e.id,
      e.job_id,
      j.status as job_status,
      e.search_task_id,
      st.query_text as search_query,
      e.document_id,
      e.error_category,
      e.message,
      e.retry_count,
      COALESCE(e.requires_human_intervention, false) as requires_human_intervention,
      e.details,
      e.occurred_at
    FROM errors e
    LEFT JOIN jobs j ON e.job_id = j.id
    LEFT JOIN search_tasks st ON e.search_task_id = st.id
    ${filter}
    ORDER BY e.occurred_at DESC
    LIMIT ${limitParam};
  `;

  const res = await query<ErrorDetail>(queryText, params);
  return res.rows;
}
