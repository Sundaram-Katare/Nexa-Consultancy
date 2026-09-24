import dotenv from "dotenv";
import { startServer } from "./server";
import { closePool } from "./db/pool";
import { browserManager } from "./browser/browserManager";

dotenv.config();

function maskDatabaseUrl(url?: string): string {
  if (!url) return "<not set>";
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return url.replace(/:([^@]+)@/, ":****@");
  }
}

async function main() {
  const port = parseInt(process.env.AGENT_PORT || "3000", 10);
  console.log("==================================================");
  console.log("🚀 STARTING NEXA AGENT API ENGINE");
  console.log("==================================================");
  console.log(`[AGENT] DATABASE_URL: ${maskDatabaseUrl(process.env.DATABASE_URL)}`);
  console.log(`[AGENT] OLLAMA_URL: ${process.env.OLLAMA_URL || "<not set>"}`);
  console.log(`[AGENT] AGENT_PORT: ${port}`);

  const server = await startServer(port);

  async function shutdown(signal: string) {
    console.log(`\n[AGENT] Received ${signal}. Gracefully closing server, browser, and database pool...`);
    try {
      await browserManager.closeAll();
      await server.close();
      await closePool();
      console.log("[AGENT] Graceful shutdown complete. Exiting cleanly.");
      process.exit(0);
    } catch (err) {
      console.error("[AGENT] Error during shutdown:", err);
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[AGENT] Fatal startup error:", err);
  process.exit(1);
});
