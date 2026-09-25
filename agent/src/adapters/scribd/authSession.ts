import { Page } from "playwright";
import { SCRIBD_CONFIG } from "./config";
import { SCRIBD_SELECTORS } from "./selectors";

export class ScribdAuthManager {
  private static isAuthenticated = false;
  private static isLoggingIn = false;

  /**
   * Checks if Scribd credentials are provided in environment variables.
   */
  static hasCredentials(): boolean {
    return Boolean(process.env.SCRIBD_USERNAME && process.env.SCRIBD_PASSWORD);
  }

  /**
   * Resets authentication state (e.g. after session invalidation or cookie expiration).
   */
  static resetSession(): void {
    this.isAuthenticated = false;
    this.isLoggingIn = false;
  }

  /**
   * Ensures an active, authenticated browser session on Scribd.
   * If credentials are not present, operates safely in public preview mode.
   */
  static async ensureAuthenticatedSession(page: Page): Promise<boolean> {
    if (this.isAuthenticated) {
      return true;
    }

    if (!this.hasCredentials()) {
      // Public / guest mode
      return false;
    }

    if (this.isLoggingIn) {
      // Wait for existing in-flight login attempt
      while (this.isLoggingIn) {
        await page.waitForTimeout(500);
      }
      return this.isAuthenticated;
    }

    this.isLoggingIn = true;
    console.log("[SCRIBD_AUTH] Establishing authenticated Scribd session...");

    try {
      await page.goto(SCRIBD_CONFIG.LOGIN_URL, {
        waitUntil: "domcontentloaded",
        timeout: SCRIBD_CONFIG.NAVIGATION_TIMEOUT_MS,
      });

      // Check if already logged in via existing cookies
      const avatar = await page.$(SCRIBD_SELECTORS.AUTH.USER_AVATAR);
      if (avatar) {
        console.log("[SCRIBD_AUTH] Session already active via persisted cookies.");
        this.isAuthenticated = true;
        return true;
      }

      // Fill credentials
      const emailInput = await page.waitForSelector(SCRIBD_SELECTORS.AUTH.EMAIL_INPUT, {
        timeout: SCRIBD_CONFIG.SELECTOR_TIMEOUT_MS,
      });
      if (!emailInput) {
        throw new Error("Could not find Scribd login email/username input.");
      }

      await emailInput.fill(process.env.SCRIBD_USERNAME!);
      await page.waitForTimeout(400);

      const passwordInput = await page.$(SCRIBD_SELECTORS.AUTH.PASSWORD_INPUT);
      if (passwordInput) {
        await passwordInput.fill(process.env.SCRIBD_PASSWORD!);
        await page.waitForTimeout(400);
      }

      // Submit
      const submitBtn = await page.$(SCRIBD_SELECTORS.AUTH.SUBMIT_BUTTON);
      if (submitBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
          submitBtn.click(),
        ]);
      }

      // Verify login succeeded
      await page.waitForTimeout(1500);
      const loginModal = await page.$(SCRIBD_SELECTORS.AUTH.PASSWORD_INPUT);
      if (loginModal) {
        console.warn("[SCRIBD_AUTH] ⚠️ Login may have encountered verification wall or incorrect credentials.");
      } else {
        console.log("[SCRIBD_AUTH] ✅ Authenticated Scribd session established successfully.");
        this.isAuthenticated = true;
      }

      return this.isAuthenticated;
    } catch (err: any) {
      console.error(`[SCRIBD_AUTH] Login flow encountered error: ${err.message}`);
      this.isAuthenticated = false;
      return false;
    } finally {
      this.isLoggingIn = false;
    }
  }
}
