import { query } from "../pool";
import { JobConfig } from "../../schemas/jobConfig";

export interface JobRow {
  id: string;
  status: "QUEUED" | "RUNNING" | "PAUSED" | "BLOCKED" | "COMPLETED" | "FAILED";
  created_at: string;
  updated_at: string;
  config: JobConfig;
}

export interface JobProgress {
  searches: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
  documents: {
    total_found: number;
    unique: number;
    duplicates: number;
    two_plus_years: number;
    less_than_two_years: number;
    needs_review: number;
    pending_classification: number;
  };
  errors: {
    total: number;
    unresolved: number;
  };
}

/**
 * Validates that all requested countries exist in the database with is_accepted = true.
 */
export async function validateAcceptedCountries(
  countryNames: string[]
): Promise<{ valid: boolean; invalidCountries: string[]; matchedCountries: { id: number; name: string }[] }> {
  if (!countryNames || countryNames.length === 0) {
    return { valid: false, invalidCountries: [], matchedCountries: [] };
  }

  const res = await query(
    `SELECT id, name FROM countries WHERE is_accepted = true;`
  );
  const acceptedCountries = res.rows;

  const matchedCountries: { id: number; name: string }[] = [];
  const invalidCountries: string[] = [];

  for (const name of countryNames) {
    const trimmed = name.trim().toLowerCase();
    const match = acceptedCountries.find(
      (c) => c.name.toLowerCase() === trimmed
    );
    if (match) {
      matchedCountries.push(match);
    } else {
      invalidCountries.push(name);
    }
  }

  return {
    valid: invalidCountries.length === 0,
    invalidCountries,
    matchedCountries,
  };
}

/**
 * Inserts a new job record with status QUEUED.
 */
export async function createJob(config: JobConfig): Promise<JobRow> {
  const res = await query<JobRow>(
    `INSERT INTO jobs (status, config) 
     VALUES ('QUEUED', $1) 
     RETURNING id, status, created_at, updated_at, config;`,
    [JSON.stringify(config)]
  );
  return res.rows[0];
}

/**
 * Retrieves a job by ID.
 */
export async function getJobById(id: string): Promise<JobRow | null> {
  const res = await query<JobRow>(
    `SELECT id, status, created_at, updated_at, config 
     FROM jobs 
     WHERE id = $1;`,
    [id]
  );
  return res.rows[0] || null;
}

/**
 * Updates a job's status.
 */
export async function updateJobStatus(
  id: string,
  newStatus: "QUEUED" | "RUNNING" | "PAUSED" | "BLOCKED" | "COMPLETED" | "FAILED"
): Promise<JobRow | null> {
  const res = await query<JobRow>(
    `UPDATE jobs 
     SET status = $2, updated_at = NOW() 
     WHERE id = $1 
     RETURNING id, status, created_at, updated_at, config;`,
    [id, newStatus]
  );
  return res.rows[0] || null;
}

/**
 * Lists jobs with optional filtering by status, staleness, and limit.
 */
export async function listJobs(options: {
  status?: string;
  staleMinutes?: number;
  limit?: number;
} = {}): Promise<JobRow[]> {
  let queryText = `SELECT id, status, created_at, updated_at, config FROM jobs WHERE 1=1`;
  const params: any[] = [];

  if (options.status) {
    params.push(options.status.toUpperCase());
    queryText += ` AND status = $${params.length}`;
  }

  if (options.staleMinutes && options.staleMinutes > 0) {
    params.push(options.staleMinutes);
    queryText += ` AND updated_at < NOW() - ($${params.length} || ' minutes')::interval`;
  }

  queryText += ` ORDER BY created_at DESC`;

  if (options.limit && options.limit > 0) {
    params.push(options.limit);
    queryText += ` LIMIT $${params.length}`;
  } else {
    queryText += ` LIMIT 50`;
  }

  const res = await query<JobRow>(queryText, params);
  return res.rows;
}


/**
 * Aggregates live progress metrics for a job across search_tasks, documents, classifications, and errors.
 */
export async function getJobProgress(jobId: string): Promise<JobProgress> {
  // 1. Searches summary
  const searchRes = await query(
    `SELECT 
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'QUEUED') as queued,
       COUNT(*) FILTER (WHERE status = 'RUNNING') as running,
       COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
       COUNT(*) FILTER (WHERE status = 'FAILED') as failed
     FROM search_tasks 
     WHERE job_id = $1;`,
    [jobId]
  );
  const sRow = searchRes.rows[0];

  // 2. Documents & Classifications summary
  const docsRes = await query(
    `SELECT 
       COUNT(d.id) as total_found,
       COUNT(d.id) FILTER (WHERE d.duplicate_of IS NULL) as unique_docs,
       COUNT(d.id) FILTER (WHERE d.duplicate_of IS NOT NULL) as duplicate_docs,
       COUNT(c.id) FILTER (WHERE c.classification = 'TWO_PLUS_YEARS') as two_plus_years,
       COUNT(c.id) FILTER (WHERE c.classification = 'LESS_THAN_TWO_YEARS') as less_than_two_years,
       COUNT(c.id) FILTER (WHERE c.classification = 'NEEDS_REVIEW') as needs_review,
       COUNT(d.id) FILTER (WHERE c.id IS NULL) as pending_classification
     FROM documents d
     LEFT JOIN classifications c ON d.id = c.document_id
     WHERE d.id IN (
       SELECT DISTINCT document_id FROM checkpoints WHERE job_id = $1
       UNION
       SELECT d2.id FROM documents d2
       JOIN search_tasks st ON d2.country_id = st.country_id
       WHERE st.job_id = $1
     );`,
    [jobId]
  );
  const dRow = docsRes.rows[0];

  // 3. Errors summary
  const errorsRes = await query(
    `SELECT 
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE resolved = false) as unresolved
     FROM errors 
     WHERE job_id = $1;`,
    [jobId]
  );
  const eRow = errorsRes.rows[0];

  return {
    searches: {
      total: parseInt(sRow.total || "0", 10),
      queued: parseInt(sRow.queued || "0", 10),
      running: parseInt(sRow.running || "0", 10),
      completed: parseInt(sRow.completed || "0", 10),
      failed: parseInt(sRow.failed || "0", 10),
    },
    documents: {
      total_found: parseInt(dRow.total_found || "0", 10),
      unique: parseInt(dRow.unique_docs || "0", 10),
      duplicates: parseInt(dRow.duplicate_docs || "0", 10),
      two_plus_years: parseInt(dRow.two_plus_years || "0", 10),
      less_than_two_years: parseInt(dRow.less_than_two_years || "0", 10),
      needs_review: parseInt(dRow.needs_review || "0", 10),
      pending_classification: parseInt(dRow.pending_classification || "0", 10),
    },
    errors: {
      total: parseInt(eRow.total || "0", 10),
      unresolved: parseInt(eRow.unresolved || "0", 10),
    },
  };
}
