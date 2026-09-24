import { query } from "../db/pool";
import { JobConfig } from "../schemas/jobConfig";
import { buildQueryVariations } from "./queryTemplates";

export interface PlanGenerationResult {
  jobId: string;
  totalPlanned: number;
  createdCount: number;
  existingCount: number;
  countriesPlanned: string[];
}

/**
 * Generates a deterministic matrix of search tasks for a given job configuration.
 * Automatically handles deduplication and idempotent re-planning.
 */
export async function generateTasks(
  jobId: string,
  config: JobConfig
): Promise<PlanGenerationResult> {
  // 1. Resolve source ID from sources table
  const sourceName = config.source.toLowerCase().trim();
  const sourceRes = await query(
    `SELECT id FROM sources WHERE LOWER(name) = LOWER($1);`,
    [sourceName]
  );
  if (sourceRes.rows.length === 0) {
    throw new Error(`Source '${config.source}' does not exist in sources table.`);
  }
  const sourceId = sourceRes.rows[0].id;

  let totalPlanned = 0;
  let createdCount = 0;
  let existingCount = 0;
  const countriesPlanned: string[] = [];

  // 2. Iterate through each requested country
  for (const country of config.countries) {
    const cleanCountry = country.trim();

    // Resolve country_id
    const countryRes = await query(
      `SELECT id, name FROM countries WHERE LOWER(name) = LOWER($1) AND is_accepted = true;`,
      [cleanCountry]
    );

    if (countryRes.rows.length === 0) {
      console.warn(`[PLANNER] Skipping unaccepted/unknown country: "${cleanCountry}"`);
      continue;
    }

    const countryId = countryRes.rows[0].id;
    const countryCanonicalName = countryRes.rows[0].name;
    countriesPlanned.push(countryCanonicalName);

    // Generate query permutations
    const queryList = buildQueryVariations(countryCanonicalName, {
      documentTypes: config.document_types,
      institutions: config.institutions,
    });

    for (const queryText of queryList) {
      totalPlanned++;

      try {
        const insertRes = await query(
          `INSERT INTO search_tasks (
             job_id, country_id, source_id, query_text, page, status
           ) VALUES ($1, $2, $3, $4, 1, 'QUEUED')
           ON CONFLICT (job_id, source_id, query_text, page) DO NOTHING
           RETURNING id;`,
          [jobId, countryId, sourceId, queryText]
        );

        if (insertRes.rows.length > 0) {
          createdCount++;
        } else {
          existingCount++;
        }
      } catch (err: any) {
        if (err.code === "23505") {
          // Unique violation - expected on re-planning
          existingCount++;
        } else {
          console.error(`[PLANNER] Error inserting search task: ${err.message}`);
          throw err;
        }
      }
    }
  }

  console.log(
    `[PLANNER] Planned job ${jobId}: ${createdCount} created, ${existingCount} already existed (Total: ${totalPlanned}) across ${countriesPlanned.length} countries.`
  );

  return {
    jobId,
    totalPlanned,
    createdCount,
    existingCount,
    countriesPlanned,
  };
}
