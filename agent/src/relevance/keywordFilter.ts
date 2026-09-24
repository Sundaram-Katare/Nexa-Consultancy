/**
 * Deterministic keyword filter for academic transcript relevance detection.
 * Separates clear transcripts from clear non-transcripts without requiring LLM calls.
 */

export type RelevanceVerdict = "RELEVANT" | "NOT_RELEVANT" | "AMBIGUOUS";

export interface RelevanceCheckResult {
  verdict: RelevanceVerdict;
  confidence: number;
  matchedPositiveTerms: string[];
  matchedExclusionTerms: string[];
  reason: string;
}

// Strong academic transcript primary keywords
const PRIMARY_TRANSCRIPT_KEYWORDS = [
  "academic transcript",
  "official transcript",
  "student transcript",
  "degree transcript",
  "university transcript",
  "college transcript",
  "academic record",
  "grade sheet",
  "gradesheet",
  "marksheet",
  "mark sheet",
  "statement of results",
  "cumulative record",
  "record of grades",
  "academic statement",
  "transcript of records",
  "transcript of academic record",
  "transcript",
];

// Supporting academic evidence terms
const SUPPORTING_ACADEMIC_SIGNALS = [
  "credit hours",
  "credits earned",
  "grade point average",
  "cumulative gpa",
  "cgpa",
  "gpa",
  "course code",
  "semester",
  "controller of examinations",
  "office of the registrar",
  "registrar",
  "degree conferred",
  "degree awarded",
  "grading scale",
  "passed with distinction",
  "major field of study",
  "total credits",
];

// Exclusion terms representing guides, request forms, slides templates, and non-transcripts
const EXCLUSION_KEYWORDS = [
  "how to request",
  "how to get",
  "guidelines for requesting",
  "request procedure",
  "transcript request form",
  "application procedure",
  "how to apply for transcript",
  "presentation template",
  "powerpoint template",
  "resume template",
  "cv template",
  "invoice template",
  "marketing strategy",
  "business plan",
  "tutorial",
  "user guide",
  "presentation tips",
  "sample slides",
  "blank template",
  "sample template",
  "template",
];

/**
 * Normalizes text for case-insensitive substring search.
 */
function cleanText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Evaluates document title and extracted evidence text against deterministic keyword rules.
 */
export function deterministicRelevanceCheck(
  title: string,
  evidenceTexts: string[] = []
): RelevanceCheckResult {
  const cleanTitle = cleanText(title);
  const combinedEvidence = cleanText(evidenceTexts.join(" "));
  const fullDocumentText = `${cleanTitle} ${combinedEvidence}`;

  // 1. Find matched primary positive terms
  const matchedPositiveInTitle: string[] = [];
  const matchedPositiveInEvidence: string[] = [];

  for (const term of PRIMARY_TRANSCRIPT_KEYWORDS) {
    if (cleanTitle.includes(term)) {
      matchedPositiveInTitle.push(term);
    } else if (combinedEvidence.includes(term)) {
      matchedPositiveInEvidence.push(term);
    }
  }

  // 2. Find matched supporting academic signals in evidence
  const matchedSupportingSignals: string[] = [];
  for (const signal of SUPPORTING_ACADEMIC_SIGNALS) {
    if (combinedEvidence.includes(signal)) {
      matchedSupportingSignals.push(signal);
    }
  }

  // 3. Find matched exclusion terms
  const matchedExclusionTerms: string[] = [];
  for (const excl of EXCLUSION_KEYWORDS) {
    if (cleanTitle.includes(excl) || combinedEvidence.includes(excl)) {
      matchedExclusionTerms.push(excl);
    }
  }

  const allMatchedPositive = Array.from(
    new Set([...matchedPositiveInTitle, ...matchedPositiveInEvidence])
  );

  // 4. Evaluate Rules

  // RULE A: Title contains primary transcript keyword
  if (matchedPositiveInTitle.length > 0) {
    if (matchedExclusionTerms.length === 0) {
      // Strong positive signal, no negative terms -> RELEVANT
      return {
        verdict: "RELEVANT",
        confidence: 0.95,
        matchedPositiveTerms: allMatchedPositive,
        matchedExclusionTerms: [],
        reason: `Title matches primary transcript keyword '${matchedPositiveInTitle[0]}' with zero exclusion terms.`,
      };
    } else {
      // Positive keyword present, but exclusion terms also detected (e.g. "transcript" + "template" or "how to request")
      // Check if evidence contains strong academic signals
      if (matchedSupportingSignals.length >= 2) {
        return {
          verdict: "AMBIGUOUS",
          confidence: 0.5,
          matchedPositiveTerms: allMatchedPositive,
          matchedExclusionTerms,
          reason: `Title contains '${matchedPositiveInTitle[0]}' but exclusion term '${matchedExclusionTerms[0]}' was present alongside supporting academic signals [${matchedSupportingSignals.join(", ")}].`,
        };
      }

      // If no strong academic signals accompany the exclusion terms, it's just a guide/template
      return {
        verdict: "NOT_RELEVANT",
        confidence: 0.85,
        matchedPositiveTerms: allMatchedPositive,
        matchedExclusionTerms,
        reason: `Title contains '${matchedPositiveInTitle[0]}' but is an excluded guide/template ('${matchedExclusionTerms[0]}') without academic performance data.`,
      };
    }
  }

  // RULE B: Title has no primary keyword, but evidence contains primary keywords + supporting academic signals
  if (matchedPositiveInEvidence.length > 0 && matchedSupportingSignals.length >= 2) {
    if (matchedExclusionTerms.length === 0) {
      return {
        verdict: "AMBIGUOUS",
        confidence: 0.65,
        matchedPositiveTerms: allMatchedPositive,
        matchedExclusionTerms: [],
        reason: `Title lacks primary keyword, but body evidence contains transcript term '${matchedPositiveInEvidence[0]}' and academic signals [${matchedSupportingSignals.join(", ")}].`,
      };
    } else {
      return {
        verdict: "AMBIGUOUS",
        confidence: 0.45,
        matchedPositiveTerms: allMatchedPositive,
        matchedExclusionTerms,
        reason: `Body contains transcript terms with mixed exclusion signals.`,
      };
    }
  }

  // RULE C: No primary keywords in title or evidence -> Clear NOT_RELEVANT
  return {
    verdict: "NOT_RELEVANT",
    confidence: 0.95,
    matchedPositiveTerms: [],
    matchedExclusionTerms,
    reason: "No academic transcript keywords found in title or body content.",
  };
}
