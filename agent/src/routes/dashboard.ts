import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import {
  getSummary,
  getByCountry,
  getByInstitution,
  getProgress,
  getErrors,
  getDashboardDocuments,
} from "../db/queries/dashboard";

interface DashboardQuery {
  jobId?: string;
  countryId?: string | number;
  limit?: string | number;
  classification?: string;
}

export const dashboardRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /dashboard/summary - Overview counts: totals, classifications, duplicates, relevance
  fastify.get(
    "/summary",
    async (request: FastifyRequest<{ Querystring: DashboardQuery }>, reply: FastifyReply) => {
      const { jobId } = request.query;
      const summary = await getSummary(jobId?.trim());

      return reply.send({
        statusCode: 200,
        scope: jobId ? { jobId: jobId.trim() } : "ALL_JOBS",
        data: summary,
      });
    }
  );

  // GET /dashboard/documents - Live discovered academic transcripts feed with canonical URLs
  fastify.get(
    "/documents",
    async (request: FastifyRequest<{ Querystring: DashboardQuery }>, reply: FastifyReply) => {
      const { jobId, limit, classification } = request.query;
      const maxLimit = limit ? Math.min(Number(limit), 200) : 100;
      const docs = await getDashboardDocuments(jobId?.trim(), maxLimit, classification?.trim());

      return reply.send({
        statusCode: 200,
        total: docs.length,
        data: docs,
      });
    }
  );

  // GET /dashboard/by-country - Per-country document and search progress breakdown
  fastify.get(
    "/by-country",
    async (request: FastifyRequest<{ Querystring: DashboardQuery }>, reply: FastifyReply) => {
      const { jobId } = request.query;
      const countries = await getByCountry(jobId?.trim());

      return reply.send({
        statusCode: 200,
        totalCountries: countries.length,
        data: countries,
      });
    }
  );

  // GET /dashboard/by-institution - Per-institution document and classification breakdown
  fastify.get(
    "/by-institution",
    async (request: FastifyRequest<{ Querystring: DashboardQuery }>, reply: FastifyReply) => {
      const { jobId, countryId } = request.query;
      const cId = countryId ? Number(countryId) : undefined;
      const institutions = await getByInstitution(jobId?.trim(), cId);

      return reply.send({
        statusCode: 200,
        totalInstitutions: institutions.length,
        data: institutions,
      });
    }
  );

  // GET /dashboard/progress - Search tasks queue status and completion percentage
  fastify.get(
    "/progress",
    async (request: FastifyRequest<{ Querystring: DashboardQuery }>, reply: FastifyReply) => {
      const { jobId } = request.query;
      const progress = await getProgress(jobId?.trim());

      return reply.send({
        statusCode: 200,
        data: progress,
      });
    }
  );

  // GET /dashboard/errors - Unresolved errors with human-needed flags
  fastify.get(
    "/errors",
    async (request: FastifyRequest<{ Querystring: DashboardQuery }>, reply: FastifyReply) => {
      const { jobId, limit } = request.query;
      const maxLimit = limit ? Math.min(Number(limit), 200) : 50;
      const errors = await getErrors(jobId?.trim(), maxLimit);

      return reply.send({
        statusCode: 200,
        totalUnresolved: errors.length,
        data: errors,
      });
    }
  );
};
