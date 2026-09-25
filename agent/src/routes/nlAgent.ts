import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { parseCommand } from "../nlAgent/commandParser";
import { validatePlan } from "../nlAgent/planValidator";
import { createJob } from "../db/queries/jobs";
import { generateTasks } from "../planner/searchPlanner";

interface CommandBody {
  text: string;
}

export const nlAgentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // POST /agent/command - Execute natural language command
  fastify.post(
    "/command",
    async (request: FastifyRequest<{ Body: CommandBody }>, reply: FastifyReply) => {
      const { text } = request.body || {};

      if (!text || typeof text !== "string" || text.trim().length === 0) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Field 'text' must be a non-empty string command.",
        });
      }

      // 1. Parse plain-English instruction into TaskPlan or Clarification
      const parseResult = await parseCommand(text);

      if (parseResult.type === "CLARIFICATION") {
        return reply.status(200).send({
          statusCode: 200,
          type: "CLARIFICATION_REQUIRED",
          needsClarification: true,
          missingFields: parseResult.missingFields,
          question: parseResult.question,
        });
      }

      // 2. Validate TaskPlan against hard database constraints
      const validation = await validatePlan(parseResult.plan);
      if (!validation.valid) {
        return reply.status(400).send({
          statusCode: 400,
          type: "VALIDATION_FAILED",
          error: "Bad Request",
          message: "The generated task plan violated authorization or validation constraints.",
          errors: validation.errors,
          plan: parseResult.plan,
        });
      }

      // 3. Create Job and generate planned search tasks using standard pipeline
      const newJob = await createJob(parseResult.plan);
      const planResult = await generateTasks(newJob.id, parseResult.plan);

      return reply.status(201).send({
        statusCode: 201,
        type: "JOB_CREATED",
        message: "Natural language command successfully planned and job created",
        jobId: newJob.id,
        status: newJob.status,
        plan: parseResult.plan,
        totalPlanned: planResult.totalPlanned,
        countriesPlanned: planResult.countriesPlanned,
      });
    }
  );
};
