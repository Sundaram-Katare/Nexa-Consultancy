import { Page } from "playwright";
import { BaseSourceAdapter } from "../baseAdapter";
import {
  SearchResult,
  SearchResultPage,
  RawMetadata,
  RawContent,
  NormalizedDocument,
} from "../types";
import { ZENODO_CONFIG } from "./config";
import { ZENODO_SELECTORS } from "./selectors";

export class ZenodoAdapter extends BaseSourceAdapter {
  public readonly id = ZENODO_CONFIG.SOURCE_ID;
  private lastRequestTimestamp = 0;

  /**
   * Enforces polite rate limiting delay between consecutive network requests.
   */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTimestamp;
    if (elapsed < ZENODO_CONFIG.MIN_REQUEST_DELAY_MS) {
      const waitTime = ZENODO_CONFIG.MIN_REQUEST_DELAY_MS - elapsed;
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
    throw new Error("Invalid session provided to ZenodoAdapter: missing Playwright Page instance.");
  }

  /**
   * Constructs the full search URL with URL-encoded query and page parameters.
   */
  protected doBuildSearchUrl(queryText: string, page: number = 1): string {
    const encodedQuery = encodeURIComponent(queryText.trim());
    return ZENODO_CONFIG.SEARCH_URL_TEMPLATE
      .replace("{query}", encodedQuery)
      .replace("{page}", page.toString());
  }

  /**
   * Extracts Zenodo Record ID from URL.
   * e.g. "https://zenodo.org/records/10045678" -> "10045678"
   */
  public getDocumentIdFromUrl(url: string): string | null {
    if (!url) return null;
    const match = url.match(/zenodo\.org\/records\/(\d+)/i) || url.match(/zenodo\.org\/record\/(\d+)/i);
    return match ? match[1] : null;
  }

  /**
   * Executes a search on Zenodo and returns structured SearchResultPage.
   */
  protected async doSearch(session: any, queryText: string): Promise<SearchResultPage> {
    await this.throttle();
    const page = this.resolvePage(session);
    const searchUrl = this.doBuildSearchUrl(queryText, 1);

    console.log(`[ZENODO] Executing search: "${queryText}" (Page 1) -> ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: ZENODO_CONFIG.NAVIGATION_TIMEOUT_MS,
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
    const queryParam = currentUrl.searchParams.get("q") || currentUrl.searchParams.get("query") || "";
    if (!queryParam) {
      return null;
    }

    const nextUrl = this.doBuildSearchUrl(queryParam, nextPage);
    console.log(`[ZENODO] Navigating to page ${nextPage}: ${nextUrl}`);

    await page.goto(nextUrl, {
      waitUntil: "domcontentloaded",
      timeout: ZENODO_CONFIG.NAVIGATION_TIMEOUT_MS,
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
    const noResults = await page.$(ZENODO_SELECTORS.SEARCH.NO_RESULTS);
    if (noResults) {
      console.log(`[ZENODO] No results found for query "${queryText}"`);
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
        const anchor = el.tagName === "A" ? (el as HTMLAnchorElement) : el.querySelector("a[href*='/records/'], a[href*='/record/']");
        const href = anchor ? (anchor as HTMLAnchorElement).href : "";

        let title = "";
        const titleEl = el.querySelector("h4.header a, a.title, div.header a, h3.header, h4.header");
        if (titleEl) {
          title = titleEl.textContent?.trim() || "";
        } else if (anchor) {
          title = anchor.textContent?.trim() || "";
        }

        const descEl = el.querySelector(".description, .extra, p");
        const snippet = descEl ? descEl.textContent?.trim() : "";

        return { href, title, snippet };
      });
    }, {
      RESULT_CARDS: ZENODO_SELECTORS.SEARCH.RESULT_CARDS,
    });

    const results: SearchResult[] = [];
    for (const card of rawCards) {
      if (!card.href || (!card.href.includes("/records/") && !card.href.includes("/record/"))) continue;

      const docId = this.getDocumentIdFromUrl(card.href);
      const cleanUrl = card.href.split("?")[0];

      results.push({
        sourceDocumentId: docId,
        canonicalUrl: cleanUrl,
        titleRaw: card.title || "Untitled Zenodo Record",
        snippetRaw: card.snippet || null,
      });
    }

    const hasNextBtn = await page.evaluate((selector) => {
      const nextEl = document.querySelector(selector);
      return nextEl !== null;
    }, ZENODO_SELECTORS.SEARCH.PAGINATION_NEXT);

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
    console.log(`[ZENODO] Opening record: ${result.canonicalUrl}`);

    const response = await page.goto(result.canonicalUrl, {
      waitUntil: "domcontentloaded",
      timeout: ZENODO_CONFIG.NAVIGATION_TIMEOUT_MS,
    });

    if (response && response.status() >= 400) {
      throw new Error(`Failed to open Zenodo record: HTTP ${response.status()} ${response.statusText()}`);
    }

    const pageTitle = (await page.title()) || "";
    if (pageTitle.toLowerCase().includes("page not found") || pageTitle.toLowerCase().includes("404")) {
      throw new Error(`Zenodo record not found (Page title: "${pageTitle}")`);
    }

    await page.waitForTimeout(1500);
  }

  /**
   * Extracts raw metadata from the record page.
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

      let creator: string | null = null;
      const creatorEl = document.querySelector(selectors.CREATOR);
      if (creatorEl) {
        creator = creatorEl.textContent?.trim() || null;
      }

      let date: string | null = null;
      const dateEl = document.querySelector(selectors.DATE);
      if (dateEl) {
        date = dateEl.getAttribute("content") || dateEl.textContent?.trim() || null;
      }

      return {
        title: title || "Untitled Zenodo Document",
        uploader: creator,
        description,
        uploadDate: date,
        documentType: "Open Access Academic Record",
        slideOrPageCount: null,
        rawAttributes: {
          url: window.location.href,
        },
      };
    }, {
      TITLE: ZENODO_SELECTORS.DOCUMENT.TITLE,
      DESCRIPTION: ZENODO_SELECTORS.DOCUMENT.DESCRIPTION,
      CREATOR: ZENODO_SELECTORS.DOCUMENT.CREATOR,
      DATE: ZENODO_SELECTORS.DOCUMENT.DATE,
    });

    return metadata;
  }

  /**
   * Extracts visible text blocks and paragraphs from the record page.
   */
  protected async doExtractContent(session: any): Promise<RawContent> {
    const page = this.resolvePage(session);

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
      TEXT_BLOCKS: ZENODO_SELECTORS.DOCUMENT.TEXT_BLOCKS,
      FALLBACK_CONTAINER: ZENODO_SELECTORS.DOCUMENT.FALLBACK_CONTAINER,
    });

    return {
      textBlocks,
      extractionMethod: "zenodo_record_dom",
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
