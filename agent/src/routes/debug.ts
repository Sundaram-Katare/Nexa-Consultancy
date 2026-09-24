/**
 * ============================================================================
 * TEMPORARY DEBUG ROUTES — PHASE 4 BROWSER ENGINE VERIFICATION ONLY
 * ============================================================================
 * These endpoints exist solely to verify end-to-end browser initialization,
 * navigation, context isolation, screenshot capture, and session teardown.
 * (Will be gated / removed in production).
 * ============================================================================
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { browserManager, BrowserNavigationError } from "../browser/browserManager";

interface NavigateBody {
  url: string;
  timeout_ms?: number;
}

export const debugRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
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
};
