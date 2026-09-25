/**
 * ============================================================================
 * DETERMINISTIC SEARCH QUERY TEMPLATES
 * ============================================================================
 * Sourced directly from the core task requirements:
 * "transcripts, academic records, grade sheets, mark sheets,
 * statements of results, degree transcripts, college/university transcripts"
 * ============================================================================
 */

export const ACADEMIC_KEYWORD_TEMPLATES: readonly string[] = [
  "transcript",
  "academic record",
  "grade sheet",
  "mark sheet",
  "statement of results",
  "degree transcript",
  "university transcript",
  "college transcript",
] as const;

/**
 * Builds deterministic search query variations for a given country and optional filters.
 * Ensures consistent, reproducible search task generation without AI hallucination.
 */
export function buildQueryVariations(
  country: string,
  options?: {
    documentTypes?: string[];
    institutions?: string[];
  }
): string[] {
  const cleanCountry = country.trim();
  const queries: string[] = [];

  // 1. General country + keyword templates (e.g. "Canada academic transcript")
  for (const keyword of ACADEMIC_KEYWORD_TEMPLATES) {
    queries.push(`${cleanCountry} ${keyword}`);
  }

  // 2. Specific institution queries if provided (e.g. "University of Toronto transcript")
  if (options?.institutions && options.institutions.length > 0) {
    for (const inst of options.institutions) {
      const cleanInst = inst.trim();
      queries.push(`${cleanInst} transcript`);
      queries.push(`${cleanInst} academic record`);
    }
  }

  // Return deduplicated query strings
  return Array.from(new Set(queries));
}

/**
 * Builds deterministic search query variations for a specific discovered institution.
 * Combines the institution name with the core academic keyword templates.
 */
export function buildInstitutionQueries(
  institutionName: string,
  country?: string
): string[] {
  const cleanInst = institutionName.trim();
  if (!cleanInst) return [];

  const queries: string[] = [];
  for (const keyword of ACADEMIC_KEYWORD_TEMPLATES) {
    queries.push(`${cleanInst} ${keyword}`);
  }

  if (country && country.trim()) {
    const cleanCountry = country.trim();
    queries.push(`${cleanInst} ${cleanCountry} transcript`);
    queries.push(`${cleanInst} ${cleanCountry} academic record`);
  }

  return Array.from(new Set(queries));
}

