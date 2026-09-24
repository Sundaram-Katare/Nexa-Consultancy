import {
  SourceAdapter,
  SearchResult,
  SearchResultPage,
  RawMetadata,
  RawContent,
  NormalizedDocument,
} from "./types";
import { query } from "../db/pool";

export type AdapterErrorCategory =
  | "NAVIGATION_TIMEOUT"
  | "ELEMENT_NOT_FOUND"
  | "EXTRACTION_ERROR"
  | "PARSING_ERROR"
  | "RATE_LIMITED"
  | "AUTH_REQUIRED"
  | "BLOCKED_OR_CAPTCHA"
  | "UNKNOWN_ERROR";

export class AdapterError extends Error {
  public readonly category: AdapterErrorCategory;
  public readonly sourceId: string;
  public readonly action: string;
  public readonly originalError?: Error;
  public readonly details?: Record<string, any>;

  constructor(
    message: string,
    category: AdapterErrorCategory,
    sourceId: string,
    action: string,
    originalError?: Error,
    details?: Record<string, any>
  ) {
    super(`[${sourceId.toUpperCase()}] [${category}] [${action}]: ${message}`);
    this.name = "AdapterError";
    this.category = category;
    this.sourceId = sourceId;
    this.action = action;
    this.originalError = originalError;
    this.details = details;
  }
}

/**
 * Base abstract class implementing standard error-wrapping, category mapping,
 * and database error logging across all source adapters.
 */
export abstract class BaseSourceAdapter implements SourceAdapter {
  public abstract readonly id: string;

  /**
   * Helper to map plain or browser exceptions into typed AdapterError
   * and log to the PostgreSQL/Supabase errors table.
   */
  protected async handleAdapterError(
    err: any,
    action: string,
    context?: Record<string, any>
  ): Promise<never> {
    if (err instanceof AdapterError) {
      throw err;
    }

    const rawMsg = err?.message || String(err);
    let category: AdapterErrorCategory = "UNKNOWN_ERROR";

    if (rawMsg.includes("Timeout") || rawMsg.includes("timeout") || rawMsg.includes("NAVIGATION_TIMEOUT")) {
      category = "NAVIGATION_TIMEOUT";
    } else if (
      rawMsg.includes("waiting for locator") ||
      rawMsg.includes("waiting for selector") ||
      rawMsg.includes("ELEMENT_NOT_FOUND")
    ) {
      category = "ELEMENT_NOT_FOUND";
    } else if (rawMsg.includes("429") || rawMsg.includes("rate limit") || rawMsg.includes("Too Many Requests")) {
      category = "RATE_LIMITED";
    } else if (rawMsg.includes("403") || rawMsg.includes("captcha") || rawMsg.includes("Cloudflare") || rawMsg.includes("challenge")) {
      category = "BLOCKED_OR_CAPTCHA";
    } else if (rawMsg.includes("401") || rawMsg.includes("login") || rawMsg.includes("sign in")) {
      category = "AUTH_REQUIRED";
    } else if (rawMsg.includes("extract") || rawMsg.includes("metadata") || rawMsg.includes("content")) {
      category = "EXTRACTION_ERROR";
    } else if (rawMsg.includes("JSON") || rawMsg.includes("parse")) {
      category = "PARSING_ERROR";
    }

    // Persist error to the database errors table if possible
    try {
      await query(
        `INSERT INTO errors (error_category, message, occurred_at, resolved)
         VALUES ($1, $2, NOW(), false);`,
        [category, `[${this.id}][${action}] ${rawMsg}`]
      );
    } catch (dbErr: any) {
      console.warn(`[ADAPTER] Failed to log error to database: ${dbErr.message}`);
    }

    const adapterError = new AdapterError(
      rawMsg,
      category,
      this.id,
      action,
      err instanceof Error ? err : undefined,
      context
    );

    throw adapterError;
  }

  // --- Public Template Methods ---

  public buildSearchUrl(queryText: string, page: number): string {
    try {
      return this.doBuildSearchUrl(queryText, page);
    } catch (err: any) {
      throw new AdapterError(
        err.message || "Failed to build search URL",
        "PARSING_ERROR",
        this.id,
        "buildSearchUrl",
        err
      );
    }
  }

  public async search(session: any, queryText: string): Promise<SearchResultPage> {
    try {
      return await this.doSearch(session, queryText);
    } catch (err: any) {
      return await this.handleAdapterError(err, "search", { query: queryText });
    }
  }

  public async getNextPage(
    session: any,
    currentPage: number
  ): Promise<SearchResultPage | null> {
    try {
      return await this.doGetNextPage(session, currentPage);
    } catch (err: any) {
      return await this.handleAdapterError(err, "getNextPage", { currentPage });
    }
  }

  public async openDocument(session: any, result: SearchResult): Promise<void> {
    try {
      await this.doOpenDocument(session, result);
    } catch (err: any) {
      return await this.handleAdapterError(err, "openDocument", { result });
    }
  }

  public async extractMetadata(session: any): Promise<RawMetadata> {
    try {
      return await this.doExtractMetadata(session);
    } catch (err: any) {
      return await this.handleAdapterError(err, "extractMetadata");
    }
  }

  public async extractContent(session: any): Promise<RawContent> {
    try {
      return await this.doExtractContent(session);
    } catch (err: any) {
      return await this.handleAdapterError(err, "extractContent");
    }
  }

  public normalize(raw: RawMetadata, searchResult: SearchResult): NormalizedDocument {
    try {
      return this.doNormalize(raw, searchResult);
    } catch (err: any) {
      throw new AdapterError(
        err.message || "Normalization failed",
        "EXTRACTION_ERROR",
        this.id,
        "normalize",
        err
      );
    }
  }

  // --- Protected Abstract Extension Points ---

  protected abstract doBuildSearchUrl(queryText: string, page: number): string;
  protected abstract doSearch(session: any, queryText: string): Promise<SearchResultPage>;
  protected abstract doGetNextPage(session: any, currentPage: number): Promise<SearchResultPage | null>;
  protected abstract doOpenDocument(session: any, result: SearchResult): Promise<void>;
  protected abstract doExtractMetadata(session: any): Promise<RawMetadata>;
  protected abstract doExtractContent(session: any): Promise<RawContent>;
  protected abstract doNormalize(raw: RawMetadata, searchResult: SearchResult): NormalizedDocument;
}
