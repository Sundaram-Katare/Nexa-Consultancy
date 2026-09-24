import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { processPendingDocuments } from "../executor/extractionWorker";
import {
  runRelevanceFilter,
  getDocumentsNeedingRelevanceReview,
} from "../relevance/relevanceFilter";
import {
  getDocumentById,
  getDocumentEvidence,
  getDocumentErrors,
  getFlaggedDuplicates,
} from "../db/queries/documents";

interface ProcessDocumentsQuery {
  sourceId?: string;
  limit?: string | number;
}

interface RelevanceFilterQuery {
  sourceId?: string;
  limit?: string | number;
}

interface DuplicatesQuery {
  confidence?: string | number;
}

interface DocumentParams {
  id: string;
}

export const documentsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // POST /documents/relevance-filter?sourceId=X&limit=N - Deterministic relevance filter
  fastify.post(
    "/relevance-filter",
    async (
      request: FastifyRequest<{ Querystring: RelevanceFilterQuery }>,
      reply: FastifyReply
    ) => {
      const sourceId = request.query.sourceId;
      const limitRaw = request.query.limit ? Number(request.query.limit) : 20;
      const limit = isNaN(limitRaw) || limitRaw <= 0 ? 20 : Math.min(limitRaw, 100);

      try {
        const summary = await runRelevanceFilter(sourceId, limit);
        return reply.status(200).send({
          statusCode: 200,
          message: `Relevance filter processed ${summary.totalProcessed} extracted documents`,
          data: summary,
        });
      } catch (err: any) {
        return reply.status(500).send({
          statusCode: 500,
          error: "RelevanceFilterError",
          message: err.message,
        });
      }
    }
  );

  // GET /documents/needs-relevance-review - Review queue for ambiguous documents
  fastify.get("/needs-relevance-review", async (request, reply: FastifyReply) => {
    const queue = await getDocumentsNeedingRelevanceReview();
    return reply.send({
      statusCode: 200,
      count: queue.length,
      queue,
    });
  });

  // GET /documents/duplicates?confidence=0.6 - List Level-3 flagged duplicates for human review
  fastify.get(
    "/duplicates",
    async (
      request: FastifyRequest<{ Querystring: DuplicatesQuery }>,
      reply: FastifyReply
    ) => {
      const confRaw = request.query.confidence ? Number(request.query.confidence) : 0.6;
      const confidence = isNaN(confRaw) ? 0.6 : confRaw;

      const duplicates = await getFlaggedDuplicates(confidence);
      return reply.send({
        statusCode: 200,
        count: duplicates.length,
        minConfidence: confidence,
        duplicates,
      });
    }
  );
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
