import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { jobsRoutes } from "./routes/jobs";
import { searchTasksRoutes } from "./routes/searchTasks";
import { documentsRoutes } from "./routes/documents";
import { errorsRoutes } from "./routes/errors";
import { debugRoutes } from "./routes/debug";
import { checkDatabaseHealth } from "./db/pool";

import path from "path";
import fastifyStatic from "@fastify/static";
import { dashboardRoutes } from "./routes/dashboard";

import { exportRoutes } from "./routes/export";

export function buildServer(): FastifyInstance {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  // Enable CORS
  server.register(cors, {
    origin: true,
  });

  // Register Static Dashboard UI
  const dashboardDir = path.resolve(__dirname, "../../dashboard");
  server.register(fastifyStatic, {
    root: dashboardDir,
    prefix: "/ui/",
    decorateReply: false,
  });

  // Health Check Endpoint
  server.get("/health", async (request, reply) => {
    const isDbHealthy = await checkDatabaseHealth();
    return reply.status(isDbHealthy ? 200 : 503).send({
      status: isDbHealthy ? "ok" : "degraded",
      service: "nexa-agent",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      database: isDbHealthy ? "connected" : "disconnected",
    });
  });

  // Register Route Groups
  server.register(jobsRoutes, { prefix: "/jobs" });
  server.register(searchTasksRoutes, { prefix: "/search-tasks" });
  server.register(documentsRoutes, { prefix: "/documents" });
  server.register(errorsRoutes, { prefix: "/errors" });
  server.register(dashboardRoutes, { prefix: "/dashboard" });
  server.register(exportRoutes);
  server.register(debugRoutes, { prefix: "/debug" });

  return server;
}

export async function startServer(port = 3000, host = "0.0.0.0") {
  const server = buildServer();

  try {
    const address = await server.listen({ port, host });
    server.log.info(`[SERVER] Agent API listening at ${address}`);
    return server;
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
