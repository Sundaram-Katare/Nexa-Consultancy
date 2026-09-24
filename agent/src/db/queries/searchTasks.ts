import { query } from "../pool";
import { deduplicationService } from "../../dedup/deduplicationService";

export interface SearchTaskRow {
  id: string;
  job_id: string;
  country_id: number;
  country_name: string;
  source_id: number;
  source_name: string;
  institution: string | null;
  query_text: string;
  page: number;
  status: "QUEUED" | "RUNNING" | "PAUSED" | "BLOCKED" | "COMPLETED" | "FAILED";
  created_at: string;
  updated_at: string;
}

/**
 * Retrieves a search task by ID with joined source and country names.
 */
export async function getSearchTaskById(id: string): Promise<SearchTaskRow | null> {
  const res = await query<SearchTaskRow>(
    `SELECT 
       st.id, st.job_id, st.country_id, c.name as country_name,
       st.source_id, s.name as source_name, st.institution,
       st.query_text, st.page, st.status, st.created_at, st.updated_at
     FROM search_tasks st
     JOIN sources s ON st.source_id = s.id
     JOIN countries c ON st.country_id = c.id
     WHERE st.id = $1;`,
    [id]
  );
  return res.rows[0] || null;
}

/**
 * Retrieves all search tasks for a specific job.
 */
export async function getSearchTasksByJob(jobId: string): Promise<SearchTaskRow[]> {
  const res = await query<SearchTaskRow>(
    `SELECT 
       st.id, st.job_id, st.country_id, c.name as country_name,
       st.source_id, s.name as source_name, st.institution,
       st.query_text, st.page, st.status, st.created_at, st.updated_at
     FROM search_tasks st
     JOIN sources s ON st.source_id = s.id
     JOIN countries c ON st.country_id = c.id
     WHERE st.job_id = $1
     ORDER BY st.created_at ASC;`,
    [jobId]
  );
  return res.rows;
}

/**
 * Updates search task status and current pagination page.
 */
export async function updateSearchTaskProgress(
  id: string,
  page: number,
  status: "QUEUED" | "RUNNING" | "PAUSED" | "BLOCKED" | "COMPLETED" | "FAILED"
): Promise<void> {
  await query(
    `UPDATE search_tasks 
     SET page = $2, status = $3, updated_at = NOW() 
     WHERE id = $1;`,
    [id, page, status]
  );
}

/**
 * Records a page search history log entry.
 */
export async function insertSearchHistory(
  searchTaskId: string,
  resultCount: number,
  rawResponseMeta?: any
): Promise<string> {
  const res = await query(
    `INSERT INTO search_history (search_task_id, executed_at, result_count, raw_response_meta) 
     VALUES ($1, NOW(), $2, $3) 
     RETURNING id;`,
    [searchTaskId, resultCount, rawResponseMeta ? JSON.stringify(rawResponseMeta) : null]
  );
  return res.rows[0].id;
}

/**
 * Inserts a newly discovered document in PENDING status.
 * Automatically handles deduplication across Level 1, Level 2, and Level 3 via DeduplicationService.
 */
export async function insertPendingDocument(doc: {
  sourceId: number;
  sourceDocId: string | null;
  canonicalUrl: string;
  title: string;
  countryId: number;
  institution?: string | null;
  educationLevel?: string | null;
  program?: string | null;
  documentType?: string | null;
}): Promise<{ inserted: boolean; id?: string; duplicate: boolean; duplicateReason?: string | null }> {
  const result = await deduplicationService.checkDuplicateAndIngest(doc);
  return {
    inserted: result.inserted,
    id: result.documentId,
    duplicate: result.isDuplicate,
    duplicateReason: result.reason,
  };
}

/**
 * Saves a progress checkpoint for crash recovery and resume tracking.
 */
export async function insertCheckpoint(
  jobId: string,
  searchTaskId: string,
  page: number,
  documentIndex: number,
  status: string
): Promise<void> {
  await query(
    `INSERT INTO checkpoints (job_id, search_task_id, page, document_index, status, saved_at)
     VALUES ($1, $2, $3, $4, $5, NOW());`,
    [jobId, searchTaskId, page, documentIndex, status]
  );
}
