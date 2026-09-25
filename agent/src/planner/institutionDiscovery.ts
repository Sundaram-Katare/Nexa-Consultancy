/**
 * ============================================================================
 * INSTITUTION DISCOVERY — SECOND-WAVE TARGETED SEARCH PLANNER
 * ============================================================================
 * Architectural Trade-off:
 * Broad country-level keyword search happens first (Phase 8), institution names
 * get harvested from those discovered documents, and THEN targeted institution
 * searches run as a second wave.
 *
 * Why this approach?
 * This avoids the fragile and error-prone alternative of trying to enumerate
 * every possible university and college in a country up front (which would require
 * a massive, brittle, and frequently outdated third-party dataset of world institutions),
 * at the cost of discovering only institutions that surface in generic search results.
 *
 * Note on SlideShare Metadata Quality:
 * SlideShare public metadata primarily exposes uploader usernames and slide titles.
 * While institution names occasionally appear in upload profiles, descriptions,
 * or titles, SlideShare lacks a structured "accredited university" field.
 * This discovery loop cleanly extracts and normalizes available institution signals
 * whenever present, while laying the robust foundation for structured sources
 * (Studocu, Scribd, Zenodo) in subsequent phases.
 * ============================================================================
 */

import { query } from "../db/pool";
import { normalizeInstitution } from "../dedup/normalize";
import { buildInstitutionQueries } from "./queryTemplates";

export interface DiscoveredInstitutionResult {
  id: number;
  name: string;
  normalizedName: string;
  status: string;
  tasksCount: number;
}

export interface InstitutionDiscoverySummary {
  jobId: string;
  countryId: number;
  countryName: string;
  documentsScanned: number;
  uniqueInstitutionsFound: number;
  newInstitutionsInserted: number;
  tasksQueued: number;
  institutions: DiscoveredInstitutionResult[];
}

/**
 * Discovers educational institution names from extracted documents for a specific country,
 * deduplicates/normalizes them via Phase 10 rules, persists them into the institutions table,
 * and generates a second wave of targeted search tasks.
 */
export async function discoverFromResults(
  jobId: string,
  countryId: number
): Promise<InstitutionDiscoverySummary> {
  console.log(
    `[INSTITUTION_DISCOVERY] Running discovery for Job ${jobId}, Country ID ${countryId}...`
  );

  // 1. Resolve country name
  const countryRes = await query<{ name: string }>(
    `SELECT name FROM countries WHERE id = $1;`,
    [countryId]
  );
  if (countryRes.rows.length === 0) {
    throw new Error(`Country with ID '${countryId}' was not found.`);
  }
  const countryName = countryRes.rows[0].name;

  // 2. Query documents for this country with non-empty institution metadata
  const docRows = await query<{
    id: string;
    institution: string;
    source_id: number;
  }>(
    `SELECT d.id, d.institution, d.source_id 
     FROM documents d
     WHERE d.country_id = $1
       AND d.institution IS NOT NULL
       AND TRIM(d.institution) != ''
     ORDER BY d.created_at ASC;`,
    [countryId]
  );

  console.log(
    `[INSTITUTION_DISCOVERY] Found ${docRows.rows.length} documents with institution metadata for ${countryName}.`
  );

  const rawInstitutionsMap = new Map<
    string,
    { rawName: string; docId: string; sourceId: number }
  >();

  // 3. Deduplicate across candidate documents using Phase 10 normalization
  for (const doc of docRows.rows) {
    const raw = doc.institution.trim();
    const normalized = normalizeInstitution(raw);
    if (normalized && !rawInstitutionsMap.has(normalized)) {
      rawInstitutionsMap.set(normalized, {
        rawName: raw,
        docId: doc.id,
        sourceId: doc.source_id,
      });
    }
  }

  const uniqueInstitutionsCount = rawInstitutionsMap.size;
  let newInstitutionsInserted = 0;
  let totalTasksQueued = 0;
  const discoveredInstitutions: DiscoveredInstitutionResult[] = [];

  // 4. Process each unique normalized institution
  for (const [normalizedName, info] of rawInstitutionsMap.entries()) {
    // Insert into institutions table if not already present
    const insertRes = await query<{
      id: number;
      name: string;
      normalized_name: string;
      status: string;
    }>(
      `INSERT INTO institutions (
         country_id, name, normalized_name, discovered_from_document_id, status
       ) VALUES ($1, $2, $3, $4, 'DISCOVERED')
       ON CONFLICT (country_id, normalized_name) DO UPDATE 
       SET name = EXCLUDED.name
       RETURNING id, name, normalized_name, status;`,
      [countryId, info.rawName, normalizedName, info.docId]
    );

    const instRow = insertRes.rows[0];
    newInstitutionsInserted++;

    // Generate deterministic queries for this institution
    const institutionQueries = buildInstitutionQueries(info.rawName, countryName);
    let tasksCreatedForInst = 0;

    for (const queryText of institutionQueries) {
      try {
        const taskInsert = await query(
          `INSERT INTO search_tasks (
             job_id, country_id, source_id, institution, query_text, page, status
           ) VALUES ($1, $2, $3, $4, $5, 1, 'QUEUED')
           ON CONFLICT (job_id, source_id, query_text, page) DO NOTHING
           RETURNING id;`,
          [jobId, countryId, info.sourceId, info.rawName, queryText]
        );

        if (taskInsert.rows.length > 0) {
          tasksCreatedForInst++;
          totalTasksQueued++;
        }
      } catch (err: any) {
        if (err.code !== "23505") {
          console.error(`[INSTITUTION_DISCOVERY] Error inserting search task: ${err.message}`);
        }
      }
    }

    // Advance institution status to 'QUEUED'
    await query(
      `UPDATE institutions 
       SET status = 'QUEUED' 
       WHERE id = $1;`,
      [instRow.id]
    );

    discoveredInstitutions.push({
      id: instRow.id,
      name: instRow.name,
      normalizedName: instRow.normalized_name,
      status: "QUEUED",
      tasksCount: tasksCreatedForInst,
    });
  }

  console.log(
    `[INSTITUTION_DISCOVERY] Completed: ${newInstitutionsInserted} institutions recorded, ${totalTasksQueued} new search tasks queued for ${countryName}.`
  );

  return {
    jobId,
    countryId,
    countryName,
    documentsScanned: docRows.rows.length,
    uniqueInstitutionsFound: uniqueInstitutionsCount,
    newInstitutionsInserted,
    tasksQueued: totalTasksQueued,
    institutions: discoveredInstitutions,
  };
}
