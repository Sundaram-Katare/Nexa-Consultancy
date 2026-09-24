import { query } from "../pool";

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
 * Automatically handles deduplication via database unique constraints.
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
}): Promise<{ inserted: boolean; id?: string; duplicate: boolean }> {
  try {
    const res = await query(
      `INSERT INTO documents (
         source_id, source_document_id, canonical_url, title, 
         country_id, institution, education_level, program, document_type, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
       ON CONFLICT (canonical_url) DO NOTHING
       RETURNING id;`,
      [
        doc.sourceId,
        doc.sourceDocId,
        doc.canonicalUrl,
        doc.title,
        doc.countryId,
        doc.institution || null,
        doc.educationLevel || null,
        doc.program || null,
        doc.documentType || null,
      ]
    );

    if (res.rows.length > 0) {
      return { inserted: true, id: res.rows[0].id, duplicate: false };
    }

    // If ON CONFLICT on canonical_url didn't return an id, it was an existing document
    return { inserted: false, duplicate: true };
  } catch (err: any) {
    if (err.code === "23505") {
      // Unique violation on (source_id, source_document_id) or canonical_url
      return { inserted: false, duplicate: true };
    }
    console.error("[SEARCH_TASKS] Unexpected error inserting pending document:", err.message);
    throw err;
  }
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
