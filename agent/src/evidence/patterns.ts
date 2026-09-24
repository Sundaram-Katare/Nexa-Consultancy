/**
 * Explicit regex patterns for extracting academic duration evidence signals.
 * Rules are kept deliberately narrow to prevent false positives from page numbers,
 * slide numbers, phone numbers, or unrelated dates.
 */

export type SignalType =
  | "DATE_RANGE"
  | "DURATION_STATEMENT"
  | "YEAR_COUNT"
  | "SEMESTER_COUNT"
  | "PROGRAM_LENGTH"
  | "GRADUATION_STATEMENT";

export interface ExtractedSignal {
  signalType: SignalType;
  rawText: string;
  extractedValue: string;
}

// 1. DATE_RANGE: Multi-year study periods (e.g. "2018 - 2022", "Sep 2019 to Jun 2021", "Fall 2018 - Spring 2022")
const DATE_RANGE_REGEX =
  /(?:(?:session|period|academic\s*years?|from|between|dates?|enrolled|duration|years?)\s*[:\-]?\s*)?(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Fall|Spring|Summer|Winter)\s+)?\b(19\d{2}|20\d{2})\s*(?:[\-\–\/]|to|until|through)\s*(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Fall|Spring|Summer|Winter)\s+)?\b(19\d{2}|20\d{2})\b/gi;

// 2. DURATION_STATEMENT: General duration declarations (e.g. "Duration of study: 3 years", "Course duration: 2 Years")
const DURATION_STATEMENT_REGEX =
  /\b(?:duration(?:\s+of\s+study)?|course\s+duration|study\s+period|period\s+of\s+study)\s*[:\-]?\s*(\d+(?:\.\d+)?|\b(?:one|two|three|four|five|six)\b)\s*(?:academic\s+)?(?:years?|yrs?|months?)\b/gi;

// 3. YEAR_COUNT: Explicit statements of completed duration (e.g. "completed 3 years", "2 years completed")
const YEAR_COUNT_REGEX =
  /\b(?:(?:completed|attended|finished|passed)\s+(\d+(?:\.\d+)?|\b(?:one|two|three|four|five|six)\b)\s*(?:academic\s+|full\s+)?years?|(\d+(?:\.\d+)?|\b(?:one|two|three|four|five|six)\b)\s*(?:academic\s+|full\s+)?years?\s*(?:of\s+study\s+)?(?:completed|attended|finished))\b/gi;

// 4. SEMESTER_COUNT: Semester / Trimester counts (NOT conflated with YEAR_COUNT!)
const SEMESTER_COUNT_REGEX =
  /\b(?:(?:completed|passed|enrolled\s+in|total\s+of)\s+(\d+|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b)\s*(?:semesters?|trimesters?|terms?)|(\d+|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b)\s*(?:semesters?|trimesters?|terms?)\s*(?:completed|passed)|(?:1st|2nd|3rd|4th|5th|6th|7th|8th|first|second|third|fourth|fifth|sixth|seventh|eighth)\s+(?:semester|trimester)\s+(?:completed|passed|results?|marks))\b/gi;

// 5. PROGRAM_LENGTH: Formal program length/structure statements (e.g. "4-year Bachelor's degree", "3-year Diploma")
const PROGRAM_LENGTH_REGEX =
  /\b(\d+|\b(?:one|two|three|four|five)\b)\s*[\-\s]year\s+(?:bachelor|undergraduate|degree|diploma|master|postgraduate|certificate|program|programme|course|curriculum)\b/gi;

// 6. GRADUATION_STATEMENT: Completion / graduation / degree conferral statements
const GRADUATION_STATEMENT_REGEX =
  /\b(?:(?:(?:degree|diploma|certificate)(?:\s+of\s+[A-Za-z\s]+?)?\s+(?:was\s+|is\s+)?(?:conferred|awarded|granted)|conferred\s+the\s+degree|awarded\s+the\s+degree)(?:\s+on|\s+in|\s*[:\-])?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4}|[A-Za-z]+\s+\d{4}|\d{4})?|(?:graduated|date\s+of\s+graduation|graduation\s+date)(?:\s+on|\s+in|\s*[:\-])\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4}|[A-Za-z]+\s+\d{4}|\d{4})?|successfully\s+completed\s+(?:all\s+)?(?:the\s+)?requirements\s+for\s+(?:the\s+)?(?:degree|graduation|diploma))\b/gi;

/**
 * Extracts all matching duration evidence signals from a raw text snippet.
 */
export function findSignalsInText(text: string): ExtractedSignal[] {
  if (!text || typeof text !== "string") {
    return [];
  }

  const signals: ExtractedSignal[] = [];
  const normalized = text.replace(/\s+/g, " ").trim();

  // Helper to run regex match loop
  const matchPattern = (
    regex: RegExp,
    signalType: SignalType,
    transformValue?: (match: RegExpExecArray) => string
  ) => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(normalized)) !== null) {
      const rawText = match[0].trim();
      const extractedValue = transformValue ? transformValue(match) : rawText;
      
      // Guard against false positive duplicate signals in the same block
      if (!signals.some((s) => s.signalType === signalType && s.rawText === rawText)) {
        signals.push({
          signalType,
          rawText,
          extractedValue: extractedValue.trim(),
        });
      }
    }
  };

  // 1. DATE_RANGE
  matchPattern(DATE_RANGE_REGEX, "DATE_RANGE", (m) => {
    const startYear = m[1];
    const endYear = m[2];
    return `${startYear} - ${endYear}`;
  });

  // 2. DURATION_STATEMENT
  matchPattern(DURATION_STATEMENT_REGEX, "DURATION_STATEMENT", (m) => m[0]);

  // 3. YEAR_COUNT
  matchPattern(YEAR_COUNT_REGEX, "YEAR_COUNT", (m) => m[0]);

  // 4. SEMESTER_COUNT
  matchPattern(SEMESTER_COUNT_REGEX, "SEMESTER_COUNT", (m) => m[0]);

  // 5. PROGRAM_LENGTH
  matchPattern(PROGRAM_LENGTH_REGEX, "PROGRAM_LENGTH", (m) => m[0]);

  // 6. GRADUATION_STATEMENT
  matchPattern(GRADUATION_STATEMENT_REGEX, "GRADUATION_STATEMENT", (m) => m[0]);

  return signals;
}
