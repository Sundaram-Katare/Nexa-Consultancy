import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

export type NavigationErrorCategory =
  | "NAVIGATION_TIMEOUT"
  | "CONNECTION_REFUSED"
  | "DNS_LOOKUP_FAILED"
  | "BLOCKED_BY_CLIENT"
  | "PAGE_CRASH"
  | "UNKNOWN_ERROR";

export class BrowserNavigationError extends Error {
  public category: NavigationErrorCategory;
  public screenshotPath?: string;
  public targetUrl: string;
  public sessionId: string;

  constructor(
    message: string,
    category: NavigationErrorCategory,
    targetUrl: string,
    sessionId: string,
    screenshotPath?: string
  ) {
    super(message);
    this.name = "BrowserNavigationError";
    this.category = category;
    this.targetUrl = targetUrl;
    this.sessionId = sessionId;
    this.screenshotPath = screenshotPath;
  }
}

export interface BrowserSession {
  id: string;
  context: BrowserContext;
  page: Page;
  createdAt: Date;
  lastActive: Date;
}

export interface NavigationResult {
  title: string;
  url: string;
  status: number | null;
  durationMs: number;
}

export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private browser: Browser | null = null;
  private sessions: Map<string, BrowserSession> = new Map();
  private isLaunching = false;
  private logsErrorDir: string;

  private constructor() {
    this.logsErrorDir =
      process.env.ERROR_LOGS_DIR ||
      path.join(process.cwd(), "logs", "errors");
    this.ensureErrorDir();
  }

  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  private ensureErrorDir(): void {
    if (!fs.existsSync(this.logsErrorDir)) {
      try {
        fs.mkdirSync(this.logsErrorDir, { recursive: true });
      } catch (err) {
        console.error("[BROWSER] Failed to create error screenshot directory:", err);
      }
    }
  }

  /**
   * Starts the shared Chromium browser instance.
   */
  public async launch(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    if (this.isLaunching) {
      // Wait for launch if concurrent requests trigger it
      while (this.isLaunching) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (this.browser && this.browser.isConnected()) {
        return this.browser;
      }
    }

    this.isLaunching = true;
    try {
      console.log("[BROWSER] Launching shared Chromium instance...");
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
        ],
      });
      console.log("[BROWSER] Chromium instance launched successfully.");
      return this.browser;
    } catch (err: any) {
      console.error("[BROWSER] Failed to launch Chromium browser:", err);
      throw err;
    } finally {
      this.isLaunching = false;
    }
  }

  /**
   * Opens a new isolated browser context and page, returning a unique sessionId.
   */
  public async newSession(options?: { userAgent?: string }): Promise<string> {
    const browser = await this.launch();
    const sessionId = randomUUID();

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        options?.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    const session: BrowserSession = {
      id: sessionId,
      context,
      page,
      createdAt: new Date(),
      lastActive: new Date(),
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /**
   * Retrieves the Page object for an active session.
   */
  public getPage(sessionId: string): Page {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Browser session '${sessionId}' does not exist or has been closed.`);
    }
    session.lastActive = new Date();
    return session.page;
  }

  /**
   * Navigates the given session to a URL with 30s timeout and error screenshot capture.
   */
  public async navigate(
    sessionId: string,
    url: string,
    timeoutMs = 30000
  ): Promise<NavigationResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Browser session '${sessionId}' does not exist.`);
    }

    const page = session.page;
    session.lastActive = new Date();
    const start = Date.now();

    try {
      const response = await page.goto(url, {
        timeout: timeoutMs,
        waitUntil: "domcontentloaded",
      });

      // Try waiting for networkidle with a short tolerance
      try {
        await page.waitForLoadState("networkidle", { timeout: 3000 });
      } catch {
        // Networkidle timeout is non-fatal for heavy pages with infinite analytics
      }

      const title = await page.title();
      const finalUrl = page.url();
      const status = response ? response.status() : null;
      const durationMs = Date.now() - start;

      return {
        title,
        url: finalUrl,
        status,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const screenshotFilename = `${sessionId}-${timestamp}.png`;
      const screenshotPath = path.join(this.logsErrorDir, screenshotFilename);

      this.ensureErrorDir();

      // Attempt to take error screenshot
      try {
        if (!page.isClosed()) {
          await page.screenshot({ path: screenshotPath, fullPage: false });
          console.log(`[BROWSER] Error screenshot saved: ${screenshotPath}`);
        }
      } catch (screenshotErr: any) {
        console.warn("[BROWSER] Could not capture failure screenshot:", screenshotErr.message);
      }

      // Categorize error
      let category: NavigationErrorCategory = "UNKNOWN_ERROR";
      const msg = err.message || "";
      if (msg.includes("Timeout") || msg.includes("timeout") || durationMs >= timeoutMs - 500) {
        category = "NAVIGATION_TIMEOUT";
      } else if (msg.includes("ERR_CONNECTION_REFUSED")) {
        category = "CONNECTION_REFUSED";
      } else if (msg.includes("ERR_NAME_NOT_RESOLVED") || msg.includes("DNS")) {
        category = "DNS_LOOKUP_FAILED";
      } else if (msg.includes("ERR_BLOCKED_BY_CLIENT")) {
        category = "BLOCKED_BY_CLIENT";
      } else if (msg.includes("Target page, context or browser has been closed")) {
        category = "PAGE_CRASH";
      }

      throw new BrowserNavigationError(
        `Navigation failed to ${url}: ${err.message}`,
        category,
        url,
        sessionId,
        fs.existsSync(screenshotPath) ? screenshotPath : undefined
      );
    }
  }

  /**
   * Takes a manual screenshot of the current page.
   */
  public async screenshot(sessionId: string, customName?: string): Promise<string> {
    const page = this.getPage(sessionId);
    this.ensureErrorDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = customName
      ? `${customName}-${timestamp}.png`
      : `${sessionId}-${timestamp}.png`;
    const fullPath = path.join(this.logsErrorDir, filename);

    await page.screenshot({ path: fullPath, fullPage: false });
    return fullPath;
  }

  /**
   * Closes a single browser session and frees resources.
   */
  public async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);
    try {
      if (!session.page.isClosed()) {
        await session.page.close();
      }
      await session.context.close();
    } catch (err: any) {
      console.warn(`[BROWSER] Error closing session ${sessionId}:`, err.message);
    }
  }

  /**
   * Closes all active sessions and the browser instance (for graceful agent shutdown).
   */
  public async closeAll(): Promise<void> {
    console.log(`[BROWSER] Closing all active sessions (${this.sessions.size})...`);
    const sessionIds = Array.from(this.sessions.keys());
    for (const id of sessionIds) {
      await this.closeSession(id);
    }

    if (this.browser) {
      try {
        await this.browser.close();
        console.log("[BROWSER] Chromium browser closed cleanly.");
      } catch (err: any) {
        console.warn("[BROWSER] Error during browser closure:", err.message);
      } finally {
        this.browser = null;
      }
    }
  }

  /**
   * Returns current active session count.
   */
  public getActiveSessionCount(): number {
    return this.sessions.size;
  }
}

export const browserManager = BrowserManager.getInstance();
