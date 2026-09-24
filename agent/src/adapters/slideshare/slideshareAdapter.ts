import { Page } from "playwright";
import { BaseSourceAdapter } from "../baseAdapter";
import {
  SearchResult,
  SearchResultPage,
  RawMetadata,
  RawContent,
  NormalizedDocument,
} from "../types";
import { SLIDESHARE_SELECTORS } from "./selectors";
import { SLIDESHARE_CONFIG } from "./config";

export class SlideShareAdapter extends BaseSourceAdapter {
  public readonly id = SLIDESHARE_CONFIG.SOURCE_ID;
  private lastRequestTimestamp = 0;

  /**
   * Enforces polite rate limiting delay between consecutive network navigations.
   */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTimestamp;
    if (elapsed < SLIDESHARE_CONFIG.MIN_REQUEST_DELAY_MS) {
      const waitTime = SLIDESHARE_CONFIG.MIN_REQUEST_DELAY_MS - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.lastRequestTimestamp = Date.now();
  }

  /**
   * Extracts or resolves the Playwright Page instance from the session object.
   */
  private resolvePage(session: any): Page {
    if (session?.page) {
      return session.page as Page;
    }
    throw new Error("Invalid session provided to SlideShareAdapter: missing Playwright Page instance.");
  }

  /**
   * Constructs search URL matching the observed SlideShare URL pattern.
   */
  protected doBuildSearchUrl(queryText: string, page: number): string {
    return SLIDESHARE_CONFIG.SEARCH_URL_TEMPLATE
      .replace("{query}", encodeURIComponent(queryText))
      .replace("{page}", page.toString());
  }

  /**
   * Executes a search query on SlideShare and extracts result cards.
   */
  protected async doSearch(session: any, queryText: string): Promise<SearchResultPage> {
    await this.throttle();
    const page = this.resolvePage(session);
    const url = this.doBuildSearchUrl(queryText, 1);

    console.log(`[SLIDESHARE] Executing search: "${queryText}" (URL: ${url})`);
    await page.goto(url, {
      timeout: SLIDESHARE_CONFIG.NAVIGATION_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });

    try {
      await page.waitForLoadState("networkidle", { timeout: 3000 });
    } catch {}

    // Wait for either result cards or empty state
    try {
      await page.waitForSelector(
        `${SLIDESHARE_SELECTORS.RESULT_CARD}, ${SLIDESHARE_SELECTORS.NO_RESULTS}`,
        { timeout: SLIDESHARE_CONFIG.SELECTOR_TIMEOUT_MS }
      );
    } catch {
      // Timeout waiting for cards - continue parsing in case content loaded without matching selector
    }

    return await this.parseSearchPage(page, 1);
  }

  /**
   * Retrieves the next page of search results.
   */
  protected async doGetNextPage(
    session: any,
    currentPage: number
  ): Promise<SearchResultPage | null> {
    await this.throttle();
    const page = this.resolvePage(session);
    const nextPage = currentPage + 1;

    // Check if next page button exists or construct URL directly
    const currentUrl = new URL(page.url());
    const queryParam = currentUrl.searchParams.get("q") || "";
    if (!queryParam) {
      return null;
    }

    const nextUrl = this.doBuildSearchUrl(queryParam, nextPage);
    console.log(`[SLIDESHARE] Navigating to page ${nextPage}: ${nextUrl}`);

    await page.goto(nextUrl, {
      timeout: SLIDESHARE_CONFIG.NAVIGATION_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });

    try {
      await page.waitForLoadState("networkidle", { timeout: 3000 });
    } catch {}

    try {
      await page.waitForSelector(
        `${SLIDESHARE_SELECTORS.RESULT_CARD}, ${SLIDESHARE_SELECTORS.NO_RESULTS}`,
        { timeout: SLIDESHARE_CONFIG.SELECTOR_TIMEOUT_MS }
      );
    } catch {
      // Non-fatal
    }

    const resultPage = await this.parseSearchPage(page, nextPage);
    if (resultPage.results.length === 0) {
      return null;
    }
    return resultPage;
  }

  /**
   * Parses result items and pagination status from the current search page.
   */
  private async parseSearchPage(page: Page, pageNumber: number): Promise<SearchResultPage> {
    const rawCards = await page.evaluate((selectors) => {
      const cards = Array.from(document.querySelectorAll(selectors.RESULT_CARD));
      return cards.map((el) => {
        const anchor = el as HTMLAnchorElement;
        const href = anchor.href || "";
        const ariaLabel = anchor.getAttribute("aria-label") || "";
        
        // Try finding inner title text if aria-label is missing
        const titleEl = anchor.querySelector(selectors.RESULT_TITLE_TEXT);
        const titleFallback = titleEl ? titleEl.textContent?.trim() : "";

        return {
          href,
          ariaLabel,
          titleFallback,
        };
      });
    }, {
      RESULT_CARD: SLIDESHARE_SELECTORS.RESULT_CARD,
      RESULT_TITLE_TEXT: SLIDESHARE_SELECTORS.RESULT_TITLE_TEXT,
    });

    const results: SearchResult[] = [];

    for (const card of rawCards) {
      if (!card.href) continue;

      // Extract Document ID from URL (e.g. /slideshow/title/285390833)
      const idMatch = card.href.match(/\/(\d+)(?:\?|$)/);
      const sourceDocumentId = idMatch ? idMatch[1] : null;

      // Parse title from aria-label or fallback
      let title = card.titleFallback || "";
      if (card.ariaLabel) {
        // e.g. "Importance of academic transcripts... by humbleshivansh, has 3 slides with 18 views."
        const titleMatch = card.ariaLabel.match(/^(.+?)(?:\s+by\s+|, has\s+|\.\s*$)/i);
        title = titleMatch ? titleMatch[1].trim() : card.ariaLabel;
      }

      if (!title) {
        title = "Untitled SlideShare Document";
      }

      // Canonical URL clean of search tracking query parameters
      const cleanUrl = card.href.split("?")[0];

      results.push({
        sourceDocumentId,
        canonicalUrl: cleanUrl,
        titleRaw: title,
        snippetRaw: card.ariaLabel || null,
      });
    }

    // Determine hasNextPage
    const hasNextBtn = await page.evaluate((selector) => {
      const nextEl = document.querySelector(selector);
      return nextEl !== null;
    }, SLIDESHARE_SELECTORS.PAGINATION_NEXT);

    // If result count is substantial (e.g. >= 8 cards), next page is likely available
    const hasNextPage = hasNextBtn || results.length >= 8;

    return {
      results,
      hasNextPage,
      pageNumber,
      rawResultCount: results.length,
    };
  }

  /**
   * Navigates to a specific SlideShare document detail page.
   */
  protected async doOpenDocument(session: any, result: SearchResult): Promise<void> {
    await this.throttle();
    const page = this.resolvePage(session);
    console.log(`[SLIDESHARE] Opening document: ${result.canonicalUrl}`);

    const response = await page.goto(result.canonicalUrl, {
      timeout: SLIDESHARE_CONFIG.NAVIGATION_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });

    if (response && response.status() >= 400) {
      throw new Error(
        `Failed to open document: HTTP ${response.status()} ${response.statusText()}`
      );
    }

    const pageTitle = (await page.title()) || "";
    if (
      pageTitle.toLowerCase().includes("page not found") ||
      pageTitle.toLowerCase().includes("404")
    ) {
      throw new Error(`Document not found (Page title: "${pageTitle}")`);
    }

    try {
      await page.waitForSelector(SLIDESHARE_SELECTORS.DOC_TITLE, {
        timeout: SLIDESHARE_CONFIG.SELECTOR_TIMEOUT_MS,
      });
    } catch {
      // Check if page ended up on a not found state
      const isNotFound = await page.evaluate(() => {
        const bodyText = document.body?.innerText || "";
        return (
          bodyText.includes("Page not found") ||
          bodyText.includes("404 - Page Not Found") ||
          bodyText.includes("This presentation is no longer available")
        );
      });
      if (isNotFound) {
        throw new Error("Document is unavailable or deleted on SlideShare (404 Not Found).");
      }
    }
  }

  /**
   * Extracts raw metadata from the document page via Next.js state data or DOM selectors.
   */
  protected async doExtractMetadata(session: any): Promise<RawMetadata> {
    const page = this.resolvePage(session);

    const metadata = await page.evaluate((selectors) => {
      // 1. Try reading Next.js __NEXT_DATA__
      let nextData: any = null;
      try {
        const script = document.querySelector(selectors.NEXT_DATA_SCRIPT);
        if (script && script.textContent) {
          nextData = JSON.parse(script.textContent);
        }
      } catch {
        nextData = null;
      }

      const pageProps = nextData?.props?.pageProps || nextData?.pageProps;
      const slideshow = pageProps?.slideshow || pageProps?.document;

      // Extract title
      const title =
        slideshow?.title ||
        document.querySelector(selectors.DOC_TITLE)?.textContent?.trim() ||
        document.querySelector("h1")?.textContent?.trim() ||
        null;

      // Extract uploader
      const uploader =
        slideshow?.user?.name ||
        slideshow?.user?.username ||
        document.querySelector(selectors.DOC_UPLOADER)?.textContent?.trim() ||
        null;

      // Extract description
      const description =
        slideshow?.description ||
        document.querySelector(selectors.DOC_DESCRIPTION)?.textContent?.trim() ||
        null;

      // Extract upload date
      const uploadDate =
        slideshow?.created_at ||
        slideshow?.updated_at ||
        document.querySelector(selectors.DOC_UPLOAD_DATE)?.getAttribute("datetime") ||
        document.querySelector(selectors.DOC_UPLOAD_DATE)?.textContent?.trim() ||
        null;

      // Extract slide count
      const slideOrPageCount =
        slideshow?.total_slides ||
        slideshow?.slide_count ||
        slideshow?.totalSlides ||
        null;

      return {
        title,
        uploader,
        description,
        uploadDate,
        documentType: "Presentation / Document",
        slideOrPageCount: slideOrPageCount ? parseInt(slideOrPageCount, 10) : null,
        rawAttributes: {
          views: slideshow?.views_count || null,
          category: slideshow?.category || null,
        },
      };
    }, {
      NEXT_DATA_SCRIPT: SLIDESHARE_SELECTORS.NEXT_DATA_SCRIPT,
      DOC_TITLE: SLIDESHARE_SELECTORS.DOC_TITLE,
      DOC_UPLOADER: SLIDESHARE_SELECTORS.DOC_UPLOADER,
      DOC_DESCRIPTION: SLIDESHARE_SELECTORS.DOC_DESCRIPTION,
      DOC_UPLOAD_DATE: SLIDESHARE_SELECTORS.DOC_UPLOAD_DATE,
    });

    if (!metadata || !metadata.title) {
      throw new Error("Unable to extract valid document metadata or title from page.");
    }

    return metadata;
  }

  /**
   * Extracts visible slide / transcript text blocks from the document page.
   */
  protected async doExtractContent(session: any): Promise<RawContent> {
    const page = this.resolvePage(session);

    const textBlocks = await page.evaluate((selectors) => {
      const blocks: string[] = [];

      // 1. Check for transcript elements
      const transcriptEls = document.querySelectorAll(selectors.DOC_CONTENT_BLOCK);
      transcriptEls.forEach((el: Element) => {
        const text = el.textContent?.trim();
        if (text && text.length > 5) {
          blocks.push(text);
        }
      });

      // 2. If no transcript containers, extract main body paragraphs
      if (blocks.length === 0) {
        const paragraphs = document.querySelectorAll("main p, article p, [role='main'] p");
        paragraphs.forEach((p: Element) => {
          const text = p.textContent?.trim();
          if (text && text.length > 10) {
            blocks.push(text);
          }
        });
      }

      return blocks;
    }, {
      DOC_CONTENT_BLOCK: SLIDESHARE_SELECTORS.DOC_CONTENT_BLOCK,
    });

    return {
      textBlocks,
      extractionMethod: "dom-text",
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
