import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { generateXlsx } from "../export/xlsxExporter";
import { generateCsv, CsvDatasetType } from "../export/csvExporter";
import { getJobById } from "../db/queries/jobs";

interface ExportParams {
  id?: string;
}

interface ExportQuery {
  format?: "xlsx" | "csv";
  dataset?: CsvDatasetType;
  jobId?: string;
}

export const exportRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Handler for generating and sending export buffer / text
  async function handleExport(
    targetJobId: string | undefined,
    format: string = "xlsx",
    dataset: CsvDatasetType = "accepted",
    reply: FastifyReply
  ) {
    const cleanJobId =
      targetJobId &&
      targetJobId !== "undefined" &&
      targetJobId !== "null" &&
      targetJobId.trim().length > 0
        ? targetJobId.trim()
        : undefined;

    if (cleanJobId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        cleanJobId
      );
      if (!isUuid) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: `Invalid Job ID format '${cleanJobId}'. Must be a valid UUID.`,
        });
      }

      const job = await getJobById(cleanJobId);
      if (!job) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Job with ID '${cleanJobId}' was not found.`,
        });
      }
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const scopeName = cleanJobId ? `job-${cleanJobId.substring(0, 8)}` : "all-jobs";

    if (format.toLowerCase() === "csv") {
      const csvData = await generateCsv(targetJobId, dataset);
      const filename = `transcript-export-${scopeName}-${dataset}-${dateStr}.csv`;

      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(csvData);
    } else {
      const xlsxBuffer = await generateXlsx(targetJobId);
      const filename = `transcript-export-${scopeName}-${dateStr}.xlsx`;

      return reply
        .header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(xlsxBuffer);
    }
  }

  // GET /jobs/:id/export - Download job export as XLSX or CSV
  fastify.get(
    "/jobs/:id/export",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: ExportQuery;
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { format = "xlsx", dataset = "accepted" } = request.query;
      return handleExport(id, format, dataset, reply);
    }
  );

  // POST /jobs/:id/export - N8N Webhook and programmatic triggering
  fastify.post(
    "/jobs/:id/export",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body?: { format?: "xlsx" | "csv"; dataset?: CsvDatasetType };
        Querystring?: ExportQuery;
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const format = request.body?.format || request.query?.format || "xlsx";
      const dataset = request.body?.dataset || request.query?.dataset || "accepted";
      return handleExport(id, format, dataset, reply);
    }
  );

  // GET /export - Download global export across all jobs
  fastify.get(
    "/export",
    async (
      request: FastifyRequest<{
        Querystring: ExportQuery;
      }>,
      reply: FastifyReply
    ) => {
      const { format = "xlsx", dataset = "accepted", jobId } = request.query;
      return handleExport(jobId, format, dataset, reply);
    }
  );
};
