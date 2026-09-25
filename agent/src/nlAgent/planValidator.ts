import { query } from "../db/pool";
import { adapterRegistry } from "../adapters/registry";
import { JobConfig } from "../schemas/jobConfig";

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a generated TaskPlan against hard database constraints and adapter authorization boundaries.
 * (Belt-and-suspenders deterministic enforcement - never trusts LLM compliance alone).
 */
export async function validatePlan(plan: JobConfig): Promise<PlanValidationResult> {
  const errors: string[] = [];

  if (!plan) {
    return { valid: false, errors: ["Plan object is missing or null."] };
  }

  // 1. Validate Source Adapter
  if (!plan.source || typeof plan.source !== "string") {
    errors.push("Plan missing required 'source' adapter field.");
  } else {
    const registeredSources = adapterRegistry.listIds();
    if (!registeredSources.includes(plan.source.toLowerCase())) {
      errors.push(
        `Source '${plan.source}' is not a registered source adapter. Available sources: [${registeredSources.join(", ")}].`
      );
    }
  }

  // 2. Validate Countries against Accepted List
  if (!plan.countries || !Array.isArray(plan.countries) || plan.countries.length === 0) {
    errors.push("Plan must specify at least one target country in 'countries' array.");
  } else {
    const acceptedRes = await query<{ name: string }>(
      `SELECT name FROM countries WHERE is_accepted = true;`
    );
    const acceptedNames = acceptedRes.rows.map((r) => r.name.toLowerCase());

    const invalidCountries: string[] = [];
    for (const country of plan.countries) {
      if (!acceptedNames.includes(country.toLowerCase().trim())) {
        invalidCountries.push(country);
      }
    }

    if (invalidCountries.length > 0) {
      errors.push(
        `The following requested countries are not in the authorized target countries list: [${invalidCountries.join(
          ", "
        )}].`
      );
    }
  }

  // 3. Validate Education Levels
  if (!plan.education_levels || !Array.isArray(plan.education_levels) || plan.education_levels.length === 0) {
    errors.push("Plan must specify at least one target education level.");
  }

  // 4. Validate Document Types
  if (!plan.document_types || !Array.isArray(plan.document_types) || plan.document_types.length === 0) {
    errors.push("Plan must specify at least one target document type.");
  }

  // 5. Validate Minimum Completed Years
  if (
    plan.minimum_completed_years === undefined ||
    plan.minimum_completed_years === null ||
    isNaN(Number(plan.minimum_completed_years)) ||
    Number(plan.minimum_completed_years) < 0
  ) {
    errors.push("Plan 'minimum_completed_years' must be a non-negative number.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
