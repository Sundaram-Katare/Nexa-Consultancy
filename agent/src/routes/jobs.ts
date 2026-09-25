import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import {
  createJobBodySchema,
  jobParamsSchema,
  JobConfig,
} from "../schemas/jobConfig";
import {
  createJob,
  getJobById,
  updateJobStatus,
  getJobProgress,
  validateAcceptedCountries,
  listJobs,
} from "../db/queries/jobs";
import { query as dbQuery } from "../db/pool";

interface JobParams {
  id: string;
}

export const jobsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /jobs - List jobs with filtering (status, staleness, limit)
  fastify.get(
    "/",
    async (
      request: FastifyRequest<{
        Querystring: {
          status?: string;
          staleMinutes?: string | number;
          limit?: string | number;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { status, staleMinutes, limit } = request.query;
      const jobs = await listJobs({
        status: status ? String(status).toUpperCase() : undefined,
        staleMinutes: staleMinutes ? Number(staleMinutes) : undefined,
        limit: limit ? Number(limit) : undefined,
      });

      return reply.send({
        statusCode: 200,
        total: jobs.length,
        jobs,
      });
    }
  );

  // POST /jobs - Create a new automation job
  fastify.post(
    "/",
    {
      schema: {
        body: createJobBodySchema,
      },
    },
    async (request: FastifyRequest<{ Body: JobConfig }>, reply: FastifyReply) => {
      const config = request.body;

      // 1. Validate requested countries against accepted list
      const countryValidation = await validateAcceptedCountries(config.countries);
      if (!countryValidation.valid) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: `The following requested countries are not in the accepted country list: ${countryValidation.invalidCountries.join(
            ", "
          )}`,
          invalid_countries: countryValidation.invalidCountries,
        });
      }

      // 2. Insert Job in QUEUED state
      const newJob = await createJob(config);

      return reply.status(201).send({
        statusCode: 201,
        message: "Job created successfully",
        id: newJob.id,
        status: newJob.status,
        config: newJob.config,
        created_at: newJob.created_at,
      });
    }
  );

  // GET /jobs/:id - Get job details and aggregated progress
  fastify.get(
    "/:id",
    {
      schema: {
        params: jobParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      const { id } = request.params;
      const job = await getJobById(id);

      if (!job) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Job with ID '${id}' was not found.`,
        });
      }

      const progress = await getJobProgress(id);

      return reply.send({
        ...job,
        progress,
      });
    }
  );

  // POST /jobs/:id/pause - Pause a running or queued job
  fastify.post(
    "/:id/pause",
    {
      schema: {
        params: jobParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      const { id } = request.params;
      const job = await getJobById(id);

      if (!job) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Job with ID '${id}' was not found.`,
        });
      }

      // State Guard: Only RUNNING or QUEUED jobs can transition to PAUSED
      if (job.status !== "RUNNING" && job.status !== "QUEUED") {
        return reply.status(409).send({
          statusCode: 409,
          error: "Conflict",
          message: `Cannot pause job with status '${job.status}'. Only RUNNING or QUEUED jobs can be paused.`,
          current_status: job.status,
        });
      }

      const updatedJob = await updateJobStatus(id, "PAUSED");

      return reply.send({
        statusCode: 200,
        message: "Job paused successfully",
        job: updatedJob,
      });
    }
  );

  // POST /jobs/:id/resume - Resume a paused job
  fastify.post(
    "/:id/resume",
    {
      schema: {
        params: jobParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      const { id } = request.params;
      const job = await getJobById(id);

      if (!job) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Job with ID '${id}' was not found.`,
        });
      }

      // State Guard: Only PAUSED or BLOCKED jobs can transition to RUNNING
      if (job.status !== "PAUSED" && job.status !== "BLOCKED") {
        return reply.status(409).send({
          statusCode: 409,
          error: "Conflict",
          message: `Cannot resume job with status '${job.status}'. Only PAUSED or BLOCKED jobs can be resumed.`,
          current_status: job.status,
        });
      }

      const updatedJob = await updateJobStatus(id, "RUNNING");

      return reply.send({
        statusCode: 200,
        message: "Job resumed successfully",
        job: updatedJob,
      });
    }
  );

  // GET /jobs/:id/progress - Get progress rollup alone
  fastify.get(
    "/:id/progress",
    {
      schema: {
        params: jobParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      const { id } = request.params;
      const job = await getJobById(id);

      if (!job) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Job with ID '${id}' was not found.`,
        });
      }

      const progress = await getJobProgress(id);

      return reply.send({
        job_id: id,
        status: job.status,
        progress,
      });
    }
  );

  // POST /jobs/:id/plan - Generate deterministic search tasks for the job
  fastify.post(
    "/:id/plan",
    {
      schema: {
        params: jobParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      const { id } = request.params;
      const job = await getJobById(id);

      if (!job) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Job with ID '${id}' was not found.`,
        });
      }

      const { generateTasks } = await import("../planner/searchPlanner");
      const planResult = await generateTasks(id, job.config);

      return reply.send({
        statusCode: 200,
        message: "Search plan generated successfully",
        ...planResult,
      });
    }
  );

  // POST /jobs/:id/resume-full - Re-drive full pipeline to completion from point of interruption
  fastify.post(
    "/:id/resume-full",
    {
      schema: {
        params: jobParamsSchema,
      },
    },
    async (
      request: FastifyRequest<{
        Params: JobParams;
        Querystring: { sync?: string | boolean };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { sync } = request.query || {};
      const job = await getJobById(id);

      if (!job) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Job with ID '${id}' was not found.`,
        });
      }

      const { resumeJob } = await import("../pipeline/jobRunner");

      if (sync === "true" || sync === true) {
        const summary = await resumeJob(id);
        return reply.send({
          statusCode: 200,
          message: "Pipeline resume executed synchronously",
          job_id: id,
          ...summary,
        });
      } else {
        // Asynchronous non-blocking background execution
        setImmediate(() => {
          resumeJob(id).catch((err) => {
            console.error(`[JOB_RUNNER] Background execution error for job ${id}:`, err);
          });
        });

        return reply.status(202).send({
          statusCode: 202,
          message: "Job pipeline execution started in background",
          job_id: id,
          status: "RUNNING",
        });
      }
    }
  );

  // POST /jobs/:id/discover-institutions - Run second-wave institution discovery & search task generation
  fastify.post(
    "/:id/discover-institutions",
    {
      schema: {
        params: jobParamsSchema,
      },
    },
    async (
      request: FastifyRequest<{
        Params: JobParams;
        Querystring: { countryId?: string };
        Body?: { countryId?: number | string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const job = await getJobById(id);

      if (!job) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Job with ID '${id}' was not found.`,
        });
      }

      const rawCountryParam =
        request.query?.countryId || (request.body as any)?.countryId;

      const { discoverFromResults } = await import(
        "../planner/institutionDiscovery"
      );
      const { query: dbQuery } = await import("../db/pool");

      let targetCountryIds: number[] = [];

      if (rawCountryParam) {
        if (!isNaN(Number(rawCountryParam))) {
          targetCountryIds.push(Number(rawCountryParam));
        } else {
          const cRes = await dbQuery<{ id: number }>(
            `SELECT id FROM countries WHERE LOWER(name) = LOWER($1);`,
            [String(rawCountryParam).trim()]
          );
          if (cRes.rows.length > 0) {
            targetCountryIds.push(cRes.rows[0].id);
          }
        }
      } else {
        // Find all countries associated with this job's tasks
        const countryRows = await dbQuery<{ country_id: number }>(
          `SELECT DISTINCT country_id FROM search_tasks WHERE job_id = $1 AND country_id IS NOT NULL;`,
          [id]
        );
        targetCountryIds = countryRows.rows.map((r) => r.country_id);
      }

      if (targetCountryIds.length === 0) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message:
            "No valid countryId provided or found for this job. Pass ?countryId=X.",
        });
      }

      const summaries = [];
      for (const cId of targetCountryIds) {
        const summary = await discoverFromResults(id, cId);
        summaries.push(summary);
      }

      return reply.send({
        statusCode: 200,
        message: "Institution discovery completed successfully",
        job_id: id,
        summaries: summaries.length === 1 ? summaries[0] : summaries,
      });
    }
  );

  // POST /jobs/reset-all - Cleanly truncate all documents, tasks, classifications, and jobs
  fastify.post("/reset-all", async (request: FastifyRequest, reply: FastifyReply) => {
    await dbQuery(`
      TRUNCATE TABLE 
        errors, 
        checkpoints, 
        classifications, 
        evidence_signals, 
        document_evidence, 
        documents, 
        search_history, 
        search_tasks, 
        job_metrics, 
        jobs, 
        institutions 
      CASCADE;
    `);
    return reply.send({
      statusCode: 200,
      message: "Database cleanly reset: all jobs, tasks, documents, and classifications cleared to 0.",
    });
  });
};



