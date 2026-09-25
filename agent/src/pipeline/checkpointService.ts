import { query } from "../db/pool";

export interface CheckpointRow {
  id: string;
  job_id: string;
  search_task_id: string | null;
  page: number | null;
  document_index: number | null;
  status: string;
  stage: string;
  saved_at: string;
}

export type PipelineStage =
  | "SEARCH"
  | "EXTRACTION"
  | "RELEVANCE_FILTER"
  | "EVIDENCE_EXTRACTION"
  | "CLASSIFICATION";

export class CheckpointService {
  /**
   * Upserts a checkpoint record in place for a specific job, task, and stage.
   * Updates in place rather than growing the checkpoints table unboundedly.
   */
  public async saveCheckpoint(
    jobId: string,
    searchTaskId: string | null,
    page: number | null,
    documentIndex: number | null,
    status: string,
    stage: PipelineStage = "SEARCH"
  ): Promise<CheckpointRow> {
    const res = await query<CheckpointRow>(
      `INSERT INTO checkpoints (
         job_id, search_task_id, page, document_index, status, stage, saved_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (job_id, COALESCE(search_task_id, '00000000-0000-0000-0000-000000000000'::uuid), stage)
       DO UPDATE SET 
         page = EXCLUDED.page,
         document_index = EXCLUDED.document_index,
         status = EXCLUDED.status,
         saved_at = NOW()
       RETURNING *;`,
      [jobId, searchTaskId, page, documentIndex, status, stage]
    );

    return res.rows[0];
  }

  /**
   * Retrieves the most recent checkpoint recorded for a given job.
   */
  public async getLatestCheckpoint(jobId: string): Promise<CheckpointRow | null> {
    const res = await query<CheckpointRow>(
      `SELECT id, job_id, search_task_id, page, document_index, status, stage, saved_at
       FROM checkpoints
       WHERE job_id = $1
       ORDER BY saved_at DESC
       LIMIT 1;`,
      [jobId]
    );
    return res.rows[0] || null;
  }

  /**
   * Retrieves all checkpoints recorded across pipeline stages for a job.
   */
  public async getJobCheckpoints(jobId: string): Promise<CheckpointRow[]> {
    const res = await query<CheckpointRow>(
      `SELECT id, job_id, search_task_id, page, document_index, status, stage, saved_at
       FROM checkpoints
       WHERE job_id = $1
       ORDER BY saved_at ASC;`,
      [jobId]
    );
    return res.rows;
  }
}

export const checkpointService = new CheckpointService();
export const saveCheckpoint = checkpointService.saveCheckpoint.bind(checkpointService);
export const getLatestCheckpoint = checkpointService.getLatestCheckpoint.bind(checkpointService);
export const getJobCheckpoints = checkpointService.getJobCheckpoints.bind(checkpointService);

