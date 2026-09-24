/**
 * Normalization helper utilities for document titles and institution names.
 */

// Common institution abbreviation / alias mappings (normalized lowercase keys)
const INSTITUTION_ALIAS_MAP: Record<string, string> = {
  "u of t": "university of toronto",
  "uoft": "university of toronto",
  "toronto university": "university of toronto",
  "mit": "massachusetts institute of technology",
  "ubc": "university of british columbia",
  "mcgill": "mcgill university",
  "u of a": "university of alberta",
  "uoa": "university of alberta",
  "u of c": "university of calgary",
  "u of waterloo": "university of waterloo",
  "uw": "university of waterloo",
  "cmu": "carnegie mellon university",
  "nyu": "new york university",
  "uc berkeley": "university of california berkeley",
  "ucla": "university of california los angeles",
  "harvard": "harvard university",
  "stanford": "stanford university",
  "oxford": "university of oxford",
  "cambridge": "university of cambridge",
};

/**
 * Normalizes a document title by lowercasing, stripping punctuation,
 * and collapsing multiple whitespace characters.
 */
export function normalizeTitle(title: string | null | undefined): string {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ") // replace punctuation with spaces
    .replace(/\s+/g, " ")     // collapse multiple spaces
    .trim();
}

/**
 * Normalizes an educational institution name by stripping punctuation,
 * collapsing whitespace, and applying known abbreviation/alias expansions.
 */
export function normalizeInstitution(name: string | null | undefined): string {
  if (!name) return "";
  const cleaned = name
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  // Check alias dictionary
  if (INSTITUTION_ALIAS_MAP[cleaned]) {
    return INSTITUTION_ALIAS_MAP[cleaned];
  }

  return cleaned;
}
