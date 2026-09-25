import { Page } from "playwright";
import { BaseSourceAdapter } from "../baseAdapter";
import {
  SearchResult,
  SearchResultPage,
  RawMetadata,
  RawContent,
  NormalizedDocument,
} from "../types";
import { SCRIBD_CONFIG } from "./config";
import { SCRIBD_SELECTORS } from "./selectors";
import { ScribdAuthManager } from "./authSession";

export class ScribdAdapter extends BaseSourceAdapter {
  public readonly id = SCRIBD_CONFIG.SOURCE_ID;
  private lastRequestTimestamp = 0;

  /**
   * Enforces polite rate limiting delay between consecutive network requests.
   */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTimestamp;
    if (elapsed < SCRIBD_CONFIG.MIN_REQUEST_DELAY_MS) {
      const waitTime = SCRIBD_CONFIG.MIN_REQUEST_DELAY_MS - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.lastRequestTimestamp = Date.now();
  }

  /**
   * Resolves the Playwright Page instance from the session object.
   */
  private resolvePage(session: any): Page {
    if (session?.page) {
      return session.page as Page;
    }
    throw new Error("Invalid session provided to ScribdAdapter: missing Playwright Page instance.");
  }

  /**
   * Constructs the full search URL with URL-encoded query and page parameters.
   */
  protected doBuildSearchUrl(queryText: string, page: number = 1): string {
    const encodedQuery = encodeURIComponent(queryText.trim());
    return SCRIBD_CONFIG.SEARCH_URL_TEMPLATE
      .replace("{query}", encodedQuery)
      .replace("{page}", page.toString());
  }

  /**
   * Extracts Scribd Document ID from document URL.
   * e.g. "https://www.scribd.com/document/123456789/Title" -> "123456789"
   */
  public getDocumentIdFromUrl(url: string): string | null {
    if (!url) return null;
    const match = url.match(/scribd\.com\/document\/(\d+)/i);
    return match ? match[1] : null;
  }

  /**
   * Executes a search on Scribd and returns structured SearchResultPage.
   */
  protected async doSearch(session: any, queryText: string): Promise<SearchResultPage> {
    await this.throttle();
    const page = this.resolvePage(session);
    const searchUrl = this.doBuildSearchUrl(queryText, 1);

    console.log(`[SCRIBD] Executing search: "${queryText}" (Page 1) -> ${searchUrl}`);

    // Ensure session (login if credentials provided)
    await ScribdAuthManager.ensureAuthenticatedSession(page);

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: SCRIBD_CONFIG.NAVIGATION_TIMEOUT_MS,
    });

    try {
      await page.waitForLoadState("networkidle", { timeout: 3000 });
    } catch {}

    return await this.parseSearchPage(page, 1, queryText);
  }

  /**
   * Fetches the next page of search results.
   */
  protected async doGetNextPage(
    session: any,
    currentPage: number
  ): Promise<SearchResultPage | null> {
    await this.throttle();
    const page = this.resolvePage(session);
    const nextPage = currentPage + 1;

    const currentUrl = new URL(page.url());
    const queryParam = currentUrl.searchParams.get("query") || currentUrl.searchParams.get("q") || "";
    if (!queryParam) {
      return null;
    }

    const nextUrl = this.doBuildSearchUrl(queryParam, nextPage);
    console.log(`[SCRIBD] Navigating to page ${nextPage}: ${nextUrl}`);

    await page.goto(nextUrl, {
      waitUntil: "domcontentloaded",
      timeout: SCRIBD_CONFIG.NAVIGATION_TIMEOUT_MS,
    });

    try {
      await page.waitForLoadState("networkidle", { timeout: 3000 });
    } catch {}

    const resultPage = await this.parseSearchPage(page, nextPage, queryParam);
    if (resultPage.results.length === 0) {
      return null;
    }
    return resultPage;
  }

  /**
   * Parses result items and pagination status from the current search page.
   */
  private async parseSearchPage(
    page: Page,
    pageNumber: number,
    queryText: string
  ): Promise<SearchResultPage> {
    // Check for no results state
    const noResults = await page.$(SCRIBD_SELECTORS.SEARCH.NO_RESULTS);
    if (noResults) {
      console.log(`[SCRIBD] No results found for query "${queryText}"`);
      return {
        results: [],
        hasNextPage: false,
        pageNumber,
        rawResultCount: 0,
      };
    }

    const rawCards = await page.evaluate((selectors) => {
      const elements = Array.from(document.querySelectorAll(selectors.RESULT_CARDS));
      return elements.map((el) => {
        const anchor = el.tagName === "A" ? (el as HTMLAnchorElement) : el.querySelector("a[href*='/document/']");
        const href = anchor ? (anchor as HTMLAnchorElement).href : "";

        let title = "";
        const titleEl = el.querySelector('[data-e2e="doc-title"], .title_link, h2, h3, span[class*="Title"]');
        if (titleEl) {
          title = titleEl.textContent?.trim() || "";
        } else if (anchor) {
          title = anchor.textContent?.trim() || "";
        }

        const descEl = el.querySelector('[data-e2e="document-description"], p.description, div[class*="Description"]');
        const snippet = descEl ? descEl.textContent?.trim() : "";

        return { href, title, snippet };
      });
    }, {
      RESULT_CARDS: SCRIBD_SELECTORS.SEARCH.RESULT_CARDS,
    });

    const results: SearchResult[] = [];
    for (const card of rawCards) {
      if (!card.href || !card.href.includes("/document/")) continue;

      const docId = this.getDocumentIdFromUrl(card.href);
      const cleanUrl = card.href.split("?")[0];

      results.push({
        sourceDocumentId: docId,
        canonicalUrl: cleanUrl,
        titleRaw: card.title || "Untitled Scribd Document",
        snippetRaw: card.snippet || null,
      });
    }

    const hasNextBtn = await page.evaluate((selector) => {
      const nextEl = document.querySelector(selector);
      return nextEl !== null;
    }, SCRIBD_SELECTORS.SEARCH.PAGINATION_NEXT);

    const hasNextPage = Boolean(hasNextBtn || results.length >= 10);

    return {
      results,
      hasNextPage,
      pageNumber,
      rawResultCount: results.length,
    };
  }

  /**
   * Navigates the shared browser page to a specific document URL.
   */
  protected async doOpenDocument(session: any, result: SearchResult): Promise<void> {
    await this.throttle();
    const page = this.resolvePage(session);
    console.log(`[SCRIBD] Opening document: ${result.canonicalUrl}`);

    await ScribdAuthManager.ensureAuthenticatedSession(page);

    const response = await page.goto(result.canonicalUrl, {
      waitUntil: "domcontentloaded",
      timeout: SCRIBD_CONFIG.NAVIGATION_TIMEOUT_MS,
    });

    if (response && response.status() >= 400) {
      throw new Error(`Failed to open Scribd document: HTTP ${response.status()} ${response.statusText()}`);
    }

    const pageTitle = (await page.title()) || "";
    if (pageTitle.toLowerCase().includes("page not found") || pageTitle.toLowerCase().includes("404")) {
      throw new Error(`Scribd document not found (Page title: "${pageTitle}")`);
    }

    await page.waitForTimeout(100);
  }

  /**
   * Extracts raw metadata from the document page.
   */
  protected async doExtractMetadata(session: any): Promise<RawMetadata> {
    const page = this.resolvePage(session);

    const metadata = await page.evaluate((selectors) => {
      let title: string | null = null;
      const titleEl = document.querySelector(selectors.TITLE);
      if (titleEl) {
        title = titleEl.textContent?.trim() || null;
      }
      if (!title) {
        title = document.title || null;
      }

      let description: string | null = null;
      const descEl = document.querySelector(selectors.DESCRIPTION);
      if (descEl) {
        description = descEl.textContent?.trim() || null;
      }

      let author: string | null = null;
      const authorEl = document.querySelector(selectors.AUTHOR);
      if (authorEl) {
        author = authorEl.textContent?.trim() || null;
      }

      let uploadDate: string | null = null;
      const dateEl = document.querySelector(selectors.UPLOAD_DATE);
      if (dateEl) {
        uploadDate = dateEl.getAttribute("datetime") || dateEl.textContent?.trim() || null;
      }

      return {
        title: title || "Untitled Document",
        uploader: author,
        description,
        uploadDate,
        documentType: "Document / Academic Record",
        slideOrPageCount: null,
        rawAttributes: {
          url: window.location.href,
        },
      };
    }, {
      TITLE: SCRIBD_SELECTORS.DOCUMENT.TITLE,
      DESCRIPTION: SCRIBD_SELECTORS.DOCUMENT.DESCRIPTION,
      AUTHOR: SCRIBD_SELECTORS.DOCUMENT.AUTHOR,
      UPLOAD_DATE: SCRIBD_SELECTORS.DOCUMENT.UPLOAD_DATE,
    });

    return metadata;
  }

  /**
   * Extracts visible text blocks and paragraphs from the document page.
   */
  protected async doExtractContent(session: any): Promise<RawContent> {
    const page = this.resolvePage(session);

    // Scroll slightly to trigger reader lazy rendering
    try {
      await page.evaluate(async () => {
        for (let i = 0; i < 3; i++) {
          window.scrollBy(0, 600);
          await new Promise((r) => setTimeout(r, 200));
        }
      });
    } catch {}

    await page.waitForTimeout(1000);

    const textBlocks = await page.evaluate((selectors) => {
      const blocks: string[] = [];
      const els = Array.from(document.querySelectorAll(selectors.TEXT_BLOCKS));
      for (const el of els) {
        const txt = el.textContent?.trim();
        if (txt && txt.length > 15) {
          blocks.push(txt);
        }
      }

      if (blocks.length === 0) {
        const fallbackEls = Array.from(document.querySelectorAll(selectors.FALLBACK_CONTAINER));
        for (const el of fallbackEls) {
          const txt = el.textContent?.trim();
          if (txt && txt.length > 20) {
            blocks.push(txt);
          }
        }
      }

      return blocks;
    }, {
      TEXT_BLOCKS: SCRIBD_SELECTORS.DOCUMENT.TEXT_BLOCKS,
      FALLBACK_CONTAINER: SCRIBD_SELECTORS.DOCUMENT.FALLBACK_CONTAINER,
    });

    return {
      textBlocks,
      extractionMethod: "scribd_reader_dom",
      confidence: textBlocks.length > 0 ? 0.9 : 0.4,
    };
  }

  /**
   * Normalizes raw metadata and search result into canonical NormalizedDocument.
   */
  protected doNormalize(raw: RawMetadata, searchResult: SearchResult): NormalizedDocument {
    return {
      sourceId: this.id,
      sourceDocumentId: searchResult.sourceDocumentId,
      canonicalUrl: searchResult.canonicalUrl,
      title: raw.title || searchResult.titleRaw,
      institution: null,
      educationLevel: null,
      program: null,
      documentType: raw.documentType || null,
      metadata: raw,
    };
  }
}
