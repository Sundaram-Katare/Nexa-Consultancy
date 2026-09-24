/**
 * ============================================================================
 * TEMPORARY DEBUG ROUTES — VERIFICATION ONLY
 * ============================================================================
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { browserManager, BrowserNavigationError } from "../browser/browserManager";
import { adapterRegistry } from "../adapters";

interface NavigateBody {
  url: string;
  timeout_ms?: number;
}

interface AdapterSearchBody {
  source?: string;
  query: string;
}

export const debugRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Basic Navigation Verification
  fastify.post(
    "/navigate",
    {
      schema: {
        body: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", minLength: 1 },
            timeout_ms: { type: "integer", minimum: 1000, default: 30000 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: NavigateBody }>, reply: FastifyReply) => {
      const { url, timeout_ms } = request.body;
      let sessionId = "";

      try {
        sessionId = await browserManager.newSession();
        const result = await browserManager.navigate(sessionId, url, timeout_ms || 30000);

        return reply.status(200).send({
          statusCode: 200,
          session_id: sessionId,
          title: result.title,
          final_url: result.url,
          http_status: result.status,
          duration_ms: result.durationMs,
        });
      } catch (err: any) {
        if (err instanceof BrowserNavigationError) {
          return reply.status(502).send({
            statusCode: 502,
            error: "BrowserNavigationError",
            category: err.category,
            message: err.message,
            target_url: err.targetUrl,
            session_id: err.sessionId,
            screenshot_saved_to: err.screenshotPath || null,
          });
        }

        return reply.status(500).send({
          statusCode: 500,
          error: "Internal Server Error",
          message: err.message || "Unknown browser navigation error",
        });
      } finally {
        if (sessionId) {
          await browserManager.closeSession(sessionId);
        }
      }
    }
  );

  // Live Adapter Search & Extraction Verification
  fastify.post(
    "/adapter-search",
    {
      schema: {
        body: {
          type: "object",
          required: ["query"],
          properties: {
            source: { type: "string", default: "slideshare" },
            query: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: AdapterSearchBody }>, reply: FastifyReply) => {
      const { source = "slideshare", query } = request.body;
      let sessionId = "";

      try {
        const adapter = adapterRegistry.get(source);
        sessionId = await browserManager.newSession();
        const page = browserManager.getPage(sessionId);
        const session = { id: sessionId, page };

        // 1. Search page 1
        const searchResult = await adapter.search(session, query);

        // 2. If results found, test document metadata extraction on the first result
        let sampleDocDetails: any = null;
        if (searchResult.results.length > 0) {
          const firstDoc = searchResult.results[0];
          await adapter.openDocument(session, firstDoc);
          const rawMetadata = await adapter.extractMetadata(session);
          const rawContent = await adapter.extractContent(session);
          const normalized = adapter.normalize(rawMetadata, firstDoc);

          sampleDocDetails = {
            rawMetadata,
            rawContentSample: rawContent.textBlocks.slice(0, 3),
            normalized,
          };
        }

        return reply.status(200).send({
          statusCode: 200,
          source: adapter.id,
          query,
          resultCount: searchResult.rawResultCount,
          hasNextPage: searchResult.hasNextPage,
          results: searchResult.results.slice(0, 5),
          sampleDocDetails,
        });
      } catch (err: any) {
        return reply.status(500).send({
          statusCode: 500,
          error: "AdapterSearchError",
          message: err.message,
        });
      } finally {
        if (sessionId) {
          await browserManager.closeSession(sessionId);
        }
      }
    }
  );
};
