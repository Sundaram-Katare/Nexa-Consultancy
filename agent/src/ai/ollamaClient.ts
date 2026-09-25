import { z } from "zod";
import { AiUnavailableError, AiInvalidResponseError } from "./schemas";

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export class OllamaClient {
  private config: OllamaConfig;

  constructor(config?: Partial<OllamaConfig>) {
    this.config = {
      baseUrl:
        config?.baseUrl ||
        process.env.OLLAMA_URL ||
        "http://localhost:11434",
      model:
        config?.model ||
        process.env.OLLAMA_MODEL ||
        "qwen2.5:4b-instruct",
      timeoutMs: config?.timeoutMs || 20000,
    };
  }

  /**
   * Health check to see if Ollama server is reachable and responsive.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Generates a structured JSON response and strictly validates it against a Zod schema.
   * Retries ONCE with explicit correction feedback on schema validation failure.
   */
  async generate<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    systemPrompt?: string
  ): Promise<T> {
    let rawOutput: string = "";
    let parseError: string = "";

    // -------------------------------------------------------------
    // Attempt 1: Standard Generation
    // -------------------------------------------------------------
    try {
      rawOutput = await this.callOllamaApi(prompt, systemPrompt);
    } catch (err: any) {
      if (err instanceof AiUnavailableError) throw err;
      throw new AiUnavailableError(err.message);
    }

    const firstAttempt = this.tryParseAndValidate(rawOutput, schema);
    if (firstAttempt.success) {
      return firstAttempt.data;
    }
    parseError = firstAttempt.error;

    console.warn(
      `[OLLAMA_CLIENT] ⚠️ First output attempt failed validation (${parseError}). Retrying once with correction feedback...`
    );

    // -------------------------------------------------------------
    // Attempt 2: Correction Retry
    // -------------------------------------------------------------
    const correctionPrompt = `${prompt}

[CRITICAL INSTRUCTION]: Your previous response could not be parsed or failed schema validation: "${parseError}".
Raw output received: "${rawOutput.substring(0, 200)}..."
You must respond ONLY with a single valid JSON object strictly conforming to the requested schema. No markdown backticks, no explanatory text outside JSON.`;

    try {
      rawOutput = await this.callOllamaApi(correctionPrompt, systemPrompt);
    } catch (err: any) {
      if (err instanceof AiUnavailableError) throw err;
      throw new AiUnavailableError(err.message);
    }

    const secondAttempt = this.tryParseAndValidate(rawOutput, schema);
    if (secondAttempt.success) {
      console.log(`[OLLAMA_CLIENT] ✅ Correction retry succeeded.`);
      return secondAttempt.data;
    }

    // Both attempts failed
    throw new AiInvalidResponseError(
      `Model failed to generate schema-conformant JSON after 2 attempts. Error: ${secondAttempt.error}. Raw output: ${rawOutput.substring(
        0,
        300
      )}`
    );
  }

  /**
   * Internal HTTP helper to call Ollama /api/generate
   */
  private async callOllamaApi(prompt: string, systemPrompt?: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(`${this.config.baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          prompt,
          system: systemPrompt,
          format: "json",
          stream: false,
          options: {
            temperature: 0.1, // Near-deterministic outputs for classification
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new AiUnavailableError(`Ollama API responded with HTTP status ${res.status}: ${res.statusText}`);
      }

      const data: any = await res.json();
      if (!data || typeof data.response !== "string") {
        throw new AiInvalidResponseError("Ollama response did not contain 'response' string field");
      }

      return data.response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new AiUnavailableError(`Ollama API request timed out after ${this.config.timeoutMs}ms`);
      }
      if (err instanceof AiUnavailableError || err instanceof AiInvalidResponseError) {
        throw err;
      }
      throw new AiUnavailableError(`Could not connect to Ollama at ${this.config.baseUrl}: ${err.message}`);
    }
  }

  /**
   * Parses JSON string and validates against schema
   */
  private tryParseAndValidate<T>(
    raw: string,
    schema: z.ZodSchema<T>
  ): { success: true; data: T } | { success: false; error: string } {
    try {
      // Strip possible markdown fences if model included them
      let cleaned = raw.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
      }

      const parsedJson = JSON.parse(cleaned);
      const validation = schema.safeParse(parsedJson);

      if (validation.success) {
        return { success: true, data: validation.data };
      } else {
        const issues = validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        return { success: false, error: `Schema validation errors: ${issues}` };
      }
    } catch (err: any) {
      return { success: false, error: `JSON parse error: ${err.message}` };
    }
  }
}

export const ollamaClient = new OllamaClient();
