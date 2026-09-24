import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { processPendingDocuments } from "../executor/extractionWorker";
import {
  getDocumentById,
  getDocumentEvidence,
  getDocumentErrors,
} from "../db/queries/documents";

interface ProcessDocumentsQuery {
  sourceId?: string;
  limit?: string | number;
}

interface DocumentParams {
  id: string;
}

export const documentsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // POST /documents/process?sourceId=X&limit=N - Trigger document extraction batch
  fastify.post(
    "/process",
    async (
      request: FastifyRequest<{ Querystring: ProcessDocumentsQuery }>,
      reply: FastifyReply
    ) => {
      const sourceId = request.query.sourceId || "slideshare";
      const limitRaw = request.query.limit ? Number(request.query.limit) : 5;
      const limit = isNaN(limitRaw) || limitRaw <= 0 ? 5 : Math.min(limitRaw, 50);

      try {
        const summary = await processPendingDocuments(sourceId, limit);
        return reply.status(200).send({
          statusCode: 200,
          message: `Processed ${summary.totalProcessed} pending documents`,
          data: summary,
        });
      } catch (err: any) {
        return reply.status(500).send({
          statusCode: 500,
          error: "ExtractionError",
          message: err.message,
        });
      }
    }
  );

  // GET /documents/:id - Get document details with status & attempts
  fastify.get(
    "/:id",
    async (request: FastifyRequest<{ Params: DocumentParams }>, reply: FastifyReply) => {
      const { id } = request.params;
      const doc = await getDocumentById(id);

      if (!doc) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Document with ID '${id}' was not found.`,
        });
      }

      return reply.send(doc);
    }
  );

  // GET /documents/:id/evidence - Get extracted evidence blocks for a document
  fastify.get(
    "/:id/evidence",
    async (request: FastifyRequest<{ Params: DocumentParams }>, reply: FastifyReply) => {
      const { id } = request.params;
      const doc = await getDocumentById(id);

      if (!doc) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Document with ID '${id}' was not found.`,
        });
      }

      const evidence = await getDocumentEvidence(id);
      const errors = await getDocumentErrors(id);

      return reply.send({
        documentId: id,
        status: doc.status,
        evidenceCount: evidence.length,
        evidence,
        errors,
      });
    }
  );
};
