import { Page } from "playwright";
import { BaseSourceAdapter } from "../baseAdapter";
import {
  SearchResult,
  SearchResultPage,
  RawMetadata,
  RawContent,
  NormalizedDocument,
} from "../types";
import { STUDOCU_CONFIG } from "./config";
import { STUDOCU_SELECTORS } from "./selectors";

export class StuDocuAdapter extends BaseSourceAdapter {
  public readonly id = STUDOCU_CONFIG.SOURCE_ID;
  private lastRequestTimestamp = 0;

  /**
   * Enforces polite rate limiting delay between consecutive network requests.
   */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTimestamp;
    if (elapsed < STUDOCU_CONFIG.MIN_REQUEST_DELAY_MS) {
      const waitTime = STUDOCU_CONFIG.MIN_REQUEST_DELAY_MS - elapsed;
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
    throw new Error("Invalid session provided to StuDocuAdapter: missing Playwright Page instance.");
  }

  /**
   * Constructs the full search URL with URL-encoded query and page parameters.
   */
  protected doBuildSearchUrl(queryText: string, page: number = 1): string {
    const encodedQuery = encodeURIComponent(queryText.trim());
    return STUDOCU_CONFIG.SEARCH_URL_TEMPLATE
      .replace("{query}", encodedQuery)
      .replace("{page}", page.toString());
  }

  /**
   * Extracts StuDocu Document ID from URL.
   * e.g. "https://www.studocu.com/en/document/university-of-toronto/computer-science/transcript/12345678" -> "12345678"
   */
  public getDocumentIdFromUrl(url: string): string | null {
    if (!url) return null;
    const match = url.match(/\/document\/.*?(\d+)(?:\?|$)/i) || url.match(/\/(\d{5,})(?:\?|$)/);
    return match ? match[1] : null;
  }

  /**
   * Executes a search on StuDocu and returns structured SearchResultPage.
   */
  protected async doSearch(session: any, queryText: string): Promise<SearchResultPage> {
    await this.throttle();
    const page = this.resolvePage(session);
    const searchUrl = this.doBuildSearchUrl(queryText, 1);

    console.log(`[STUDOCU] Executing search: "${queryText}" (Page 1) -> ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: STUDOCU_CONFIG.NAVIGATION_TIMEOUT_MS,
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
    console.log(`[STUDOCU] Navigating to page ${nextPage}: ${nextUrl}`);

    await page.goto(nextUrl, {
      waitUntil: "domcontentloaded",
      timeout: STUDOCU_CONFIG.NAVIGATION_TIMEOUT_MS,
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
    const noResults = await page.$(STUDOCU_SELECTORS.SEARCH.NO_RESULTS);
    if (noResults) {
      console.log(`[STUDOCU] No results found for query "${queryText}"`);
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
        const titleEl = el.querySelector("h3, h4, span[data-testid='document-title'], div.title");
        if (titleEl) {
          title = titleEl.textContent?.trim() || "";
        } else if (anchor) {
          title = anchor.textContent?.trim() || "";
        }

        const instEl = el.querySelector(selectors.INSTITUTION);
        const inst = instEl ? instEl.textContent?.trim() : "";

        const descEl = el.querySelector(selectors.DESCRIPTION);
        const snippet = descEl ? descEl.textContent?.trim() : "";

        return { href, title, institution: inst, snippet };
      });
    }, {
      RESULT_CARDS: STUDOCU_SELECTORS.SEARCH.RESULT_CARDS,
      INSTITUTION: STUDOCU_SELECTORS.SEARCH.INSTITUTION,
      DESCRIPTION: STUDOCU_SELECTORS.SEARCH.DESCRIPTION,
    });

    const results: SearchResult[] = [];
    for (const card of rawCards) {
      if (!card.href || !card.href.includes("/document/")) continue;

      const docId = this.getDocumentIdFromUrl(card.href);
      const cleanUrl = card.href.split("?")[0];

      results.push({
        sourceDocumentId: docId,
        canonicalUrl: cleanUrl,
        titleRaw: card.title || "Untitled StuDocu Document",
        snippetRaw: card.snippet || (card.institution ? `Institution: ${card.institution}` : null),
      });
    }

    const hasNextBtn = await page.evaluate((selector) => {
      const nextEl = document.querySelector(selector);
      return nextEl !== null;
    }, STUDOCU_SELECTORS.SEARCH.PAGINATION_NEXT);

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
    console.log(`[STUDOCU] Opening document: ${result.canonicalUrl}`);

    const response = await page.goto(result.canonicalUrl, {
      waitUntil: "domcontentloaded",
      timeout: STUDOCU_CONFIG.NAVIGATION_TIMEOUT_MS,
    });

    if (response && response.status() >= 400) {
      throw new Error(`Failed to open StuDocu document: HTTP ${response.status()} ${response.statusText()}`);
    }

    const pageTitle = (await page.title()) || "";
    if (pageTitle.toLowerCase().includes("page not found") || pageTitle.toLowerCase().includes("404")) {
      throw new Error(`StuDocu document not found (Page title: "${pageTitle}")`);
    }

    await page.waitForTimeout(1500);
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

      let institution: string | null = null;
      const instEl = document.querySelector(selectors.INSTITUTION);
      if (instEl) {
        institution = instEl.textContent?.trim() || null;
      }

      let course: string | null = null;
      const courseEl = document.querySelector(selectors.COURSE);
      if (courseEl) {
        course = courseEl.textContent?.trim() || null;
      }

      let date: string | null = null;
      const dateEl = document.querySelector(selectors.DATE);
      if (dateEl) {
        date = dateEl.textContent?.trim() || null;
      }

      return {
        title: title || "Untitled StuDocu Document",
        uploader: institution || null,
        description,
        uploadDate: date,
        documentType: course ? `Course Document: ${course}` : "University Study Document",
        slideOrPageCount: null,
        rawAttributes: {
          institution,
          course,
          url: window.location.href,
        },
      };
    }, {
      TITLE: STUDOCU_SELECTORS.DOCUMENT.TITLE,
      DESCRIPTION: STUDOCU_SELECTORS.DOCUMENT.DESCRIPTION,
      INSTITUTION: STUDOCU_SELECTORS.DOCUMENT.INSTITUTION,
      COURSE: STUDOCU_SELECTORS.DOCUMENT.COURSE,
      DATE: STUDOCU_SELECTORS.DOCUMENT.DATE,
    });

    return metadata;
  }

  /**
   * Extracts visible text blocks and paragraphs from the document page.
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
      TEXT_BLOCKS: STUDOCU_SELECTORS.DOCUMENT.TEXT_BLOCKS,
      FALLBACK_CONTAINER: STUDOCU_SELECTORS.DOCUMENT.FALLBACK_CONTAINER,
    });

    return {
      textBlocks,
      extractionMethod: "studocu_preview_dom",
      confidence: textBlocks.length > 0 ? 0.9 : 0.4,
    };
  }

  /**
   * Normalizes raw metadata and search result into canonical NormalizedDocument.
   */
  protected doNormalize(raw: RawMetadata, searchResult: SearchResult): NormalizedDocument {
    const inst = raw.rawAttributes?.institution || null;
    const course = raw.rawAttributes?.course || null;

    return {
      sourceId: this.id,
      sourceDocumentId: searchResult.sourceDocumentId,
      canonicalUrl: searchResult.canonicalUrl,
      title: raw.title || searchResult.titleRaw,
      institution: inst,
      educationLevel: null,
      program: course,
      documentType: raw.documentType || null,
      metadata: raw,
    };
  }
}
