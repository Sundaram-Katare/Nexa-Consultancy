import { Page } from "playwright";

/**
 * Single search result extracted from a source's search listing.
 */
export interface SearchResult {
  sourceDocumentId: string | null;
  canonicalUrl: string;
  titleRaw: string;
  snippetRaw: string | null;
}

/**
 * Full page of search results with pagination state.
 */
export interface SearchResultPage {
  results: SearchResult[];
  hasNextPage: boolean;
  pageNumber: number;
  rawResultCount: number;
}

/**
 * Raw metadata extracted from a document page prior to normalization.
 */
export interface RawMetadata {
  title: string;
  uploader: string | null;
  description: string | null;
  uploadDate: string | null;
  documentType: string | null;
  slideOrPageCount: number | null;
  rawAttributes?: Record<string, any>;
}

/**
 * Raw text content and extraction evidence from a document.
 */
export interface RawContent {
  textBlocks: string[];
  extractionMethod: string;
  confidence?: number;
}

/**
 * Canonical normalized document matching the target database schema.
 */
export interface NormalizedDocument {
  sourceId: string;
  sourceDocumentId: string | null;
  canonicalUrl: string;
  title: string;
  institution: string | null;
  educationLevel: string | null;
  program: string | null;
  documentType: string | null;
  metadata?: RawMetadata;
}

/**
 * Universal interface that every website adapter must implement.
 * Allows the core crawler, queue worker, and classifier to interact
 * uniformly with any repository without knowing site-specific details.
 */
export interface SourceAdapter {
  readonly id: string;

  /**
   * Constructs the search URL for a given query text and page number.
   */
  buildSearchUrl(query: string, page: number): string;

  /**
   * Executes a search on the target site and parses the result items.
   */
  search(session: { page?: Page; [key: string]: any }, query: string): Promise<SearchResultPage>;

  /**
   * Traverses to the next page of results.
   */
  getNextPage(
    session: { page?: Page; [key: string]: any },
    currentPage: number
  ): Promise<SearchResultPage | null>;

  /**
   * Navigates to a specific document detail/viewer page.
   */
  openDocument(
    session: { page?: Page; [key: string]: any },
    result: SearchResult
  ): Promise<void>;

  /**
   * Extracts raw document metadata from the currently active document view.
   */
  extractMetadata(session: { page?: Page; [key: string]: any }): Promise<RawMetadata>;

  /**
   * Extracts visible transcript text and structural blocks from the document view.
   */
  extractContent(session: { page?: Page; [key: string]: any }): Promise<RawContent>;

  /**
   * Normalizes raw metadata and search snippets into the canonical schema.
   */
  normalize(raw: RawMetadata, searchResult: SearchResult): NormalizedDocument;
}
