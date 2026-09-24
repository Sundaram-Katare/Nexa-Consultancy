import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { runTask } from "../executor/searchExecutor";
import { getSearchTaskById } from "../db/queries/searchTasks";

interface SearchTaskParams {
  id: string;
}

interface RunTaskBody {
  max_pages?: number;
}

export const searchTasksRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /search-tasks/:id - Retrieve search task details
  fastify.get(
    "/:id",
    async (request: FastifyRequest<{ Params: SearchTaskParams }>, reply: FastifyReply) => {
      const { id } = request.params;
      const task = await getSearchTaskById(id);

      if (!task) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Search task with ID '${id}' was not found.`,
        });
      }

      return reply.send(task);
    }
  );

  // POST /search-tasks/:id/run - Execute search task through adapter & pagination
  fastify.post(
    "/:id/run",
    async (
      request: FastifyRequest<{ Params: SearchTaskParams; Body: RunTaskBody }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const maxPages = request.body?.max_pages || 20;

      const task = await getSearchTaskById(id);
      if (!task) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Search task with ID '${id}' was not found.`,
        });
      }

      try {
        const execution = await runTask(id, maxPages);
        return reply.status(200).send({
          statusCode: 200,
          message: "Search task executed successfully",
          execution,
        });
      } catch (err: any) {
        return reply.status(500).send({
          statusCode: 500,
          error: "TaskExecutionError",
          message: err.message,
        });
      }
    }
  );
};
