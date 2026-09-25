/**
 * Builds the strict, anti-hallucination prompt for Relevance Detection of academic documents.
 */
export function buildRelevancePrompt(
  title: string,
  evidenceTexts: string[]
): { system: string; prompt: string } {
  const system = `You are a strict academic record document evaluator. Your sole job is to determine whether a web-harvested document is genuinely an academic transcript, mark sheet, statement of results, or official student academic record.
You must adhere strictly to evidence-based evaluation and NEVER guess. If the content is ambiguous or represents general course notes, syllabi, textbooks, presentations, or administrative forms rather than a student academic record, set relevant: false.`;

  const truncatedEvidence = evidenceTexts
    .slice(0, 10)
    .map((text, idx) => `[Evidence Fragment ${idx + 1}]:\n${text.slice(0, 400)}`)
    .join("\n\n");

  const prompt = `Evaluate the following document metadata and text fragments to determine if this is an authentic academic transcript, mark sheet, or student academic record.

[DOCUMENT TITLE]: "${title}"

[EXTRACTED TEXT FRAGMENTS]:
${truncatedEvidence || "No extracted text fragments available."}

[TASK]:
Determine if this document is an academic transcript, grade report, statement of results, or cumulative academic record.

[OUTPUT REQUIREMENTS]:
Respond ONLY with a JSON object with these exact fields:
{
  "relevant": boolean,      // true ONLY if explicitly an academic transcript/marksheet; false otherwise
  "confidence": number,     // confidence score between 0.0 and 1.0 (use < 0.6 if uncertain)
  "reasoning": string       // concise explanation citing specific text fragments or explaining why it is not a transcript
}

[ANTI-HALLUCINATION RULES]:
1. Do NOT guess. If the text does not explicitly show student grades, courses, marks, or degree transcripts, set relevant=false.
2. Presentation slides, lecture summaries, dissertation abstracts, and syllabus overviews are NOT transcripts (set relevant=false).`;

  return { system, prompt };
}
