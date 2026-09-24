export interface JobConfig {
  source: string;
  countries: string[];
  education_levels: string[];
  document_types: string[];
  minimum_completed_years: number;
  institutions?: string[];
  max_pages_per_search?: number;
  [key: string]: any;
}

export const createJobBodySchema = {
  type: "object",
  required: [
    "source",
    "countries",
    "education_levels",
    "document_types",
    "minimum_completed_years",
  ],
  properties: {
    source: {
      type: "string",
      minLength: 1,
      description: "Target source adapter, e.g. scribd, slideshare, archive_org",
    },
    countries: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
      description: "List of accepted countries to search",
    },
    education_levels: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
      description: "Target education credentials (e.g. Diploma, Bachelor, Master)",
    },
    document_types: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
      description: "Target document keywords (e.g. Transcript, Marksheet, Statement of Results)",
    },
    minimum_completed_years: {
      type: "number",
      minimum: 0,
      description: "Minimum completed academic years threshold (e.g. 2.0)",
    },
    institutions: {
      type: "array",
      items: { type: "string" },
      description: "Optional specific universities/colleges to target",
    },
    max_pages_per_search: {
      type: "integer",
      minimum: 1,
      default: 20,
      description: "Maximum pagination pages to crawl per search combination",
    },
  },
  additionalProperties: true,
};

export const jobParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: {
      type: "string",
      format: "uuid",
      description: "Job UUID",
    },
  },
};
