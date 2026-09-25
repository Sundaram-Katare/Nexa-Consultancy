/**
 * Builds the strict natural language planning prompt for converting user commands into JobConfig.
 */
export function buildPlanningPrompt(
  commandText: string,
  availableSources: string[],
  acceptedCountries: string[]
): { system: string; prompt: string } {
  const system = `You are an automated browser agent task planner for academic record harvesting.
Your job is to parse a plain-English user instruction and produce EITHER a structured automation JobConfig JSON OR a Clarification Request JSON.

[REGISTERED SOURCE ADAPTERS]:
${availableSources.join(", ")}

[ACCEPTED TARGET COUNTRIES (Whitelist)]:
${acceptedCountries.join(", ")}

[STRICT AUTHORIZATION AND PLANNING RULES]:
1. Whitelist Only: You MUST ONLY select countries from the ACCEPTED TARGET COUNTRIES list. If the user mentions an unaccepted country (e.g. France, Germany, India, etc. not in the whitelist), set needsClarification: true and explain that the country is not authorized/accepted.
2. Source Adapter: You MUST ONLY select a source from the REGISTERED SOURCE ADAPTERS list. Default to "${availableSources[0] || "slideshare"}" if not specified. If an unknown source is requested, set needsClarification: true.
3. Country Requirement: At least one valid whitelisted country MUST be specified. If no country is mentioned, set needsClarification: true with question asking which country to search.
4. Defaults for Academic Record Tasks:
   - education_levels: ["Bachelor", "Master"] (or specific levels mentioned in command like "Diploma", "PhD", "Undergraduate")
   - document_types: ["Transcript"] (or specific types like "Marksheet", "Grade Report", "Statement of Results")
   - minimum_completed_years: 2.0 (or specified number)
   - max_pages_per_search: 10
5. Generic / Future Tasks: If the command is about non-academic or general browsing on a registered source, set reasonable search document_types/keywords matching the user intent.`;

  const prompt = `Convert the following user command into an automation JobConfig JSON or a Clarification Request JSON:

[USER COMMAND]:
"${commandText}"

[OUTPUT FORMAT REQUIREMENT]:
Respond ONLY with a single valid JSON object matching ONE of these two schema shapes:

Option A (Valid Plan):
{
  "type": "PLAN",
  "plan": {
    "source": "slideshare",
    "countries": ["Canada"],
    "education_levels": ["Bachelor", "Master"],
    "document_types": ["Transcript"],
    "minimum_completed_years": 2.0,
    "institutions": [],
    "max_pages_per_search": 10
  }
}

Option B (Clarification Needed / Out-of-Bounds Request):
{
  "type": "CLARIFICATION",
  "needsClarification": true,
  "missingFields": ["countries"], // or ["unaccepted_country", "unregistered_source"]
  "question": "Clear explanation of what is missing or why the requested target is not in the authorized whitelist."
}`;

  return { system, prompt };
}
