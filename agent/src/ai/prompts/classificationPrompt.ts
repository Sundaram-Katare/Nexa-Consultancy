import { EvidenceSignal } from "../../evidence/patterns";

/**
 * Builds the strict anti-hallucination prompt for 2-Year Duration Classification.
 * NOTE: This is ONLY invoked when evidence signals exist but have formatting/phrasing ambiguity.
 */
export function buildClassificationPrompt(
  title: string,
  signals: EvidenceSignal[]
): { system: string; prompt: string } {
  const system = `You are a forensic academic credential verifier. Your job is to determine whether an academic transcript documents at least 2 completed academic years (e.g. Bachelor, Master, 2+ year Diploma) versus less than 2 years (e.g. 1-year Certificate/Diploma), or whether duration remains ambiguous (NEEDS_REVIEW).
You must follow strict anti-hallucination rules:
1. ONLY count years that were actually COMPLETED as evidenced in the transcript text (dates attended, graduation date, completed semesters/years).
2. NEVER guess or infer completed duration simply from the name of the degree (e.g. do not assume a "Bachelor" is 3 or 4 years without date/year evidence in the text).
3. If the duration signals are incomplete or cannot be mathematically verified, you MUST return "NEEDS_REVIEW".`;

  const signalsFormatted = signals
    .map(
      (s, idx) =>
        `[Signal ${idx + 1} (${s.signal_type}) - Conf: ${s.confidence}]: "${s.raw_text}" (Extracted Value: ${JSON.stringify(
          s.extracted_value
        )})`
    )
    .join("\n");

  const prompt = `Analyze the following extracted duration evidence signals from document "${title}" to classify the completed academic duration.

[EXTRACTED DURATION SIGNALS]:
${signalsFormatted || "No signals provided."}

[TASK]:
Classify the document into one of three categories:
- TWO_PLUS_YEARS: If evidence clearly establishes >= 2 completed academic years (e.g., span between start/end dates >= 2 years, or explicit completion of Year 2/3/4 or 4+ semesters).
- LESS_THAN_TWO_YEARS: If evidence clearly establishes < 2 completed academic years (e.g., 1-year program completed).
- NEEDS_REVIEW: If evidence is ambiguous, incomplete, semester count without year confirmation, or unverified.

[OUTPUT REQUIREMENTS]:
Respond ONLY with a JSON object conforming to:
{
  "classification": "TWO_PLUS_YEARS" | "LESS_THAN_TWO_YEARS" | "NEEDS_REVIEW",
  "completedYears": number | null, // e.g. 2.0, 3.0, 4.0 or null if ambiguous
  "reasoning": string,             // Defensible explanation quoting the exact signal dates/semesters
  "confidence": number             // Score between 0.0 and 1.0
}

[STRICT CONSTRAINTS]:
- Do NOT assume duration. If dates only show 1 semester or 1 year, do NOT extrapolate to 2+ years without proof.`;

  return { system, prompt };
}
