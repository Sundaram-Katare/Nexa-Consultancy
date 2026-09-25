import { z } from "zod";
import { query } from "../db/pool";
import { adapterRegistry } from "../adapters/registry";
import { ollamaClient } from "../ai/ollamaClient";
import { buildPlanningPrompt } from "./prompts/planningPrompt";
import { JobConfig } from "../schemas/jobConfig";

export const JobPlanSchema = z.object({
  source: z.string().min(1),
  countries: z.array(z.string().min(1)).min(1),
  education_levels: z.array(z.string()).default(["Bachelor", "Master"]),
  document_types: z.array(z.string()).default(["Transcript"]),
  minimum_completed_years: z.number().min(0).default(2.0),
  institutions: z.array(z.string()).optional().default([]),
  max_pages_per_search: z.number().int().min(1).default(10),
});

export const TaskPlanResultSchema = z.object({
  type: z.literal("PLAN"),
  plan: JobPlanSchema,
});

export const ClarificationRequestSchema = z.object({
  type: z.literal("CLARIFICATION").optional().default("CLARIFICATION"),
  needsClarification: z.literal(true),
  missingFields: z.array(z.string()).default([]),
  question: z.string().min(1),
});

export const NlAgentResultSchema = z.union([
  TaskPlanResultSchema,
  ClarificationRequestSchema,
  // Also handle direct unnested plan if model returned it directly
  JobPlanSchema.transform((p) => ({ type: "PLAN" as const, plan: p })),
]);

export type TaskPlanResult =
  | { type: "PLAN"; plan: JobConfig }
  | { type: "CLARIFICATION"; needsClarification: true; missingFields: string[]; question: string };

/**
 * Parses a plain-English user instruction into a structured JobConfig plan or Clarification Request.
 */
export async function parseCommand(commandText: string): Promise<TaskPlanResult> {
  const trimmed = (commandText || "").trim();
  if (!trimmed) {
    return {
      type: "CLARIFICATION",
      needsClarification: true,
      missingFields: ["text"],
      question: "Please provide an instruction for the browser automation agent.",
    };
  }

  // 1. Fetch live accepted countries from database
  const countriesRes = await query<{ name: string }>(
    `SELECT name FROM countries WHERE is_accepted = true ORDER BY name ASC;`
  );
  const acceptedCountries = countriesRes.rows.map((r) => r.name);

  // 2. Fetch registered source adapter IDs
  const availableSources = adapterRegistry.listIds();

  // 3. Build planning prompt
  const { system, prompt } = buildPlanningPrompt(trimmed, availableSources, acceptedCountries);

  // 4. Invoke Ollama Local AI with schema validation
  try {
    const result = await ollamaClient.generate(prompt, NlAgentResultSchema, system);

    if ("needsClarification" in result && result.needsClarification) {
      return {
        type: "CLARIFICATION",
        needsClarification: true,
        missingFields: result.missingFields || [],
        question: result.question,
      };
    }

    if ("plan" in result) {
      return {
        type: "PLAN",
        plan: result.plan as JobConfig,
      };
    }

    throw new Error("Invalid output shape from natural language planner.");
  } catch (err: any) {
    console.warn(
      `[NL_AGENT] Local AI planning failed or unavailable (${err.message}). Performing deterministic fallback parsing...`
    );

    // Fallback parser: Check if any accepted country is explicitly named in the text
    const matchedCountries: string[] = [];
    for (const cName of acceptedCountries) {
      const regex = new RegExp(`\\b${cName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(trimmed)) {
        matchedCountries.push(cName);
      }
    }

    if (matchedCountries.length > 0) {
      // Find source if specified, else default
      let chosenSource = availableSources[0] || "slideshare";
      for (const src of availableSources) {
        if (new RegExp(`\\b${src}\\b`, "i").test(trimmed)) {
          chosenSource = src;
          break;
        }
      }

      // Check education levels
      const educationLevels: string[] = [];
      if (/bachelor/i.test(trimmed)) educationLevels.push("Bachelor");
      if (/master/i.test(trimmed)) educationLevels.push("Master");
      if (/diploma/i.test(trimmed)) educationLevels.push("Diploma");
      if (/phd|doctorate/i.test(trimmed)) educationLevels.push("PhD");
      if (educationLevels.length === 0) educationLevels.push("Bachelor", "Master");

      // Check document types
      const docTypes: string[] = [];
      if (/transcript/i.test(trimmed)) docTypes.push("Transcript");
      if (/marksheet/i.test(trimmed)) docTypes.push("Marksheet");
      if (/statement of results/i.test(trimmed)) docTypes.push("Statement of Results");
      if (/grade report/i.test(trimmed)) docTypes.push("Grade Report");
      if (docTypes.length === 0) docTypes.push("Transcript");

      return {
        type: "PLAN",
        plan: {
          source: chosenSource,
          countries: matchedCountries,
          education_levels: educationLevels,
          document_types: docTypes,
          minimum_completed_years: 2.0,
          institutions: [],
          max_pages_per_search: 10,
        },
      };
    }

    // Could not deterministically identify an accepted country
    return {
      type: "CLARIFICATION",
      needsClarification: true,
      missingFields: ["countries"],
      question:
        "Could not determine target country from your command. Please specify an accepted target country (e.g. Canada, Ghana, Liberia, Nigeria, United Kingdom, USA, etc.).",
    };
  }
}
