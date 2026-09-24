import { EvidenceSignalRow } from "../evidence/evidenceExtractor";

export type ClassificationCategory =
  | "TWO_PLUS_YEARS"
  | "LESS_THAN_TWO_YEARS"
  | "NEEDS_REVIEW";

export interface ClassificationDecision {
  classification: ClassificationCategory;
  completedYears: number | null;
  durationText: string | null;
  confidence: number;
  reasoning: string;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

/**
 * Parses start year, end year, and span in years from a DATE_RANGE signal string.
 */
export function parseDateRangeSpan(
  extractedValue: string | null,
  rawText: string
): { startYear: number; endYear: number; spanYears: number } | null {
  const text = (extractedValue || rawText || "").trim();
  const yearMatches = text.match(/\b(19\d{2}|20\d{2})\b/g);

  if (!yearMatches || yearMatches.length < 2) {
    return null;
  }

  const startYear = parseInt(yearMatches[0], 10);
  const endYear = parseInt(yearMatches[yearMatches.length - 1], 10);

  if (isNaN(startYear) || isNaN(endYear) || endYear < startYear) {
    return null;
  }

  const spanYears = endYear - startYear;
  return { startYear, endYear, spanYears };
}

/**
 * Parses numeric completed years from a YEAR_COUNT signal.
 */
export function parseYearCount(
  extractedValue: string | null,
  rawText: string
): number | null {
  const text = (extractedValue || rawText || "").toLowerCase();

  // Try numeric match
  const numMatch = text.match(/\b(\d+(?:\.\d+)?)\b/);
  if (numMatch) {
    const val = parseFloat(numMatch[1]);
    if (!isNaN(val) && val > 0 && val <= 10) {
      return val;
    }
  }

  // Try word match
  for (const [word, val] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) {
      return val;
    }
  }

  return null;
}

/**
 * Deterministically classifies document duration strictly following anti-hallucination rules.
 * Missing, conflicting, or unsupported inferences resolve to NEEDS_REVIEW, never a guess.
 */
export function candidateClassification(
  signals: EvidenceSignalRow[]
): ClassificationDecision {
  if (!signals || signals.length === 0) {
    // RULE 5: Zero evidence signals -> NEEDS_REVIEW
    return {
      classification: "NEEDS_REVIEW",
      completedYears: null,
      durationText: null,
      confidence: 0.1,
      reasoning: "no_evidence_found",
    };
  }

  const dateRangeSignals = signals.filter((s) => s.signal_type === "DATE_RANGE");
  const yearCountSignals = signals.filter((s) => s.signal_type === "YEAR_COUNT");
  const durationStatements = signals.filter((s) => s.signal_type === "DURATION_STATEMENT");
  const semesterSignals = signals.filter((s) => s.signal_type === "SEMESTER_COUNT");
  const programLengthSignals = signals.filter((s) => s.signal_type === "PROGRAM_LENGTH");
  const graduationSignals = signals.filter((s) => s.signal_type === "GRADUATION_STATEMENT");

  // ==========================================================================
  // CONFLICT CHECK: Disagreements between multiple signals of the same type
  // ==========================================================================
  if (dateRangeSignals.length > 1) {
    const spans = dateRangeSignals
      .map((s) => parseDateRangeSpan(s.extracted_value, s.raw_text)?.spanYears)
      .filter((s): s is number => s !== undefined && s !== null);

    const minSpan = Math.min(...spans);
    const maxSpan = Math.max(...spans);

    // If date ranges contradict each other (e.g. 2018-2020 [2 yrs] vs 2018-2022 [4 yrs])
    if (spans.length > 1 && maxSpan - minSpan > 0) {
      return {
        classification: "NEEDS_REVIEW",
        completedYears: null,
        durationText: dateRangeSignals.map((s) => s.raw_text).join("; "),
        confidence: 0.5,
        reasoning: "conflicting_evidence",
      };
    }
  }

  if (yearCountSignals.length > 1) {
    const counts = yearCountSignals
      .map((s) => parseYearCount(s.extracted_value, s.raw_text))
      .filter((c): c is number => c !== null);

    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);

    if (counts.length > 1 && maxCount !== minCount) {
      return {
        classification: "NEEDS_REVIEW",
        completedYears: null,
        durationText: yearCountSignals.map((s) => s.raw_text).join("; "),
        confidence: 0.5,
        reasoning: "conflicting_evidence",
      };
    }
  }

  // ==========================================================================
  // RULE 1: DATE_RANGE Signal (Strongest evidence type)
  // ==========================================================================
  if (dateRangeSignals.length > 0) {
    const range = parseDateRangeSpan(
      dateRangeSignals[0].extracted_value,
      dateRangeSignals[0].raw_text
    );

    if (range) {
      const span = range.spanYears;
      if (span >= 2) {
        return {
          classification: "TWO_PLUS_YEARS",
          completedYears: span,
          durationText: `${span} years (${range.startYear} - ${range.endYear})`,
          confidence: 0.95,
          reasoning: "verified_date_range",
        };
      } else {
        return {
          classification: "LESS_THAN_TWO_YEARS",
          completedYears: span,
          durationText: `${span} year(s) (${range.startYear} - ${range.endYear})`,
          confidence: 0.95,
          reasoning: "verified_date_range",
        };
      }
    }
  }

  // ==========================================================================
  // RULE 2: YEAR_COUNT or DURATION_STATEMENT Signal
  // ==========================================================================
  const explicitYearsList = [...yearCountSignals, ...durationStatements];
  if (explicitYearsList.length > 0) {
    const years = parseYearCount(
      explicitYearsList[0].extracted_value,
      explicitYearsList[0].raw_text
    );

    if (years !== null) {
      if (years >= 2) {
        return {
          classification: "TWO_PLUS_YEARS",
          completedYears: years,
          durationText: `${years} completed years (${explicitYearsList[0].raw_text})`,
          confidence: 0.85,
          reasoning: "explicit_completed_years",
        };
      } else {
        return {
          classification: "LESS_THAN_TWO_YEARS",
          completedYears: years,
          durationText: `${years} completed year(s) (${explicitYearsList[0].raw_text})`,
          confidence: 0.85,
          reasoning: "explicit_completed_years",
        };
      }
    }
  }

  // ==========================================================================
  // RULE 3: Only SEMESTER_COUNT Signals Exist (Never guess conversion)
  // ==========================================================================
  if (semesterSignals.length > 0) {
    return {
      classification: "NEEDS_REVIEW",
      completedYears: null,
      durationText: semesterSignals[0].raw_text,
      confidence: 0.5,
      reasoning: "semester_count_without_year_confirmation",
    };
  }

  // ==========================================================================
  // RULE 4: Only PROGRAM_LENGTH or GRADUATION_STATEMENT Signals Exist
  // ==========================================================================
  if (programLengthSignals.length > 0) {
    return {
      classification: "NEEDS_REVIEW",
      completedYears: null,
      durationText: programLengthSignals[0].raw_text,
      confidence: 0.4,
      reasoning: "program_length_not_completed_duration",
    };
  }

  if (graduationSignals.length > 0) {
    return {
      classification: "NEEDS_REVIEW",
      completedYears: null,
      durationText: graduationSignals[0].raw_text,
      confidence: 0.4,
      reasoning: "graduation_without_duration_evidence",
    };
  }

  // Fallback for any other unhandled signal state
  return {
    classification: "NEEDS_REVIEW",
    completedYears: null,
    durationText: signals[0].raw_text,
    confidence: 0.3,
    reasoning: "insufficient_duration_evidence",
  };
}
