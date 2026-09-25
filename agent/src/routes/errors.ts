import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { query } from "../db/pool";

interface ErrorsQuery {
  resolved?: string | boolean;
  requiresHumanIntervention?: string | boolean;
  requiresHuman?: string | boolean;
  errorCategory?: string;
  jobId?: string;
  limit?: string | number;
}

interface ErrorParams {
  id: string;
}

export const errorsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /errors - Query error records with filters for n8n Error Monitor and dashboard
  fastify.get(
    "/",
    async (request: FastifyRequest<{ Querystring: ErrorsQuery }>, reply: FastifyReply) => {
      const {
        resolved,
        requiresHumanIntervention,
        requiresHuman,
        errorCategory,
        jobId,
        limit,
      } = request.query;

      let queryText = `
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
          e.occurred_at, 
          COALESCE(e.resolved, false) as resolved
        FROM errors e
        LEFT JOIN jobs j ON e.job_id = j.id
        LEFT JOIN search_tasks st ON e.search_task_id = st.id
        WHERE 1=1
      `;
      const params: any[] = [];

      // 1. Filter by resolved status
      if (resolved !== undefined) {
        const isResolved = resolved === true || resolved === "true" || resolved === "1";
        params.push(isResolved);
        queryText += ` AND COALESCE(e.resolved, false) = $${params.length}`;
      }

      // 2. Filter by human intervention flag
      const humanFlag = requiresHumanIntervention ?? requiresHuman;
      if (humanFlag !== undefined) {
        const isHuman = humanFlag === true || humanFlag === "true" || humanFlag === "1";
        params.push(isHuman);
        queryText += ` AND COALESCE(e.requires_human_intervention, false) = $${params.length}`;
      }

      // 3. Filter by category
      if (errorCategory) {
        params.push(errorCategory.toUpperCase().trim());
        queryText += ` AND UPPER(e.error_category) = $${params.length}`;
      }

      // 4. Filter by Job ID
      if (jobId) {
        params.push(jobId.trim());
        queryText += ` AND e.job_id = $${params.length}`;
      }

      queryText += ` ORDER BY e.occurred_at DESC`;

      // 5. Limit
      const maxLimit = limit ? Math.min(Number(limit), 200) : 50;
      params.push(maxLimit);
      queryText += ` LIMIT $${params.length};`;

      const res = await query<{
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
        resolved: boolean;
      }>(queryText, params);

      const mappedErrors = res.rows.map((row) => ({
        id: row.id,
        jobId: row.job_id,
        jobStatus: row.job_status,
        searchTaskId: row.search_task_id,
        searchQuery: row.search_query,
        documentId: row.document_id,
        errorCategory: row.error_category,
        message: row.message,
        retryCount: row.retry_count,
        requiresHumanIntervention: row.requires_human_intervention,
        details: row.details,
        occurredAt: row.occurred_at,
        resolved: row.resolved,
      }));

      return reply.send({
        statusCode: 200,
        total: mappedErrors.length,
        errors: mappedErrors,
      });
    }
  );

  // POST /errors/:id/resolve - Mark an error as resolved
  fastify.post(
    "/:id/resolve",
    async (request: FastifyRequest<{ Params: ErrorParams }>, reply: FastifyReply) => {
      const { id } = request.params;

      const res = await query(
        `UPDATE errors 
         SET resolved = true 
         WHERE id = $1 
         RETURNING id, resolved;`,
        [id]
      );

      if (res.rows.length === 0) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Error record with ID '${id}' was not found.`,
        });
      }

      return reply.send({
        statusCode: 200,
        message: "Error marked as resolved successfully",
        id,
        resolved: true,
      });
    }
  );
};
