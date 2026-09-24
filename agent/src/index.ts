import dotenv from "dotenv";

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
    // If not standard URL format, regex mask credentials
    return url.replace(/:([^@]+)@/, ":****@");
  }
}

console.log("[AGENT] agent alive");
const dbUrl = process.env.DATABASE_URL;
console.log(`[AGENT] DATABASE_URL: ${maskDatabaseUrl(dbUrl)}`);
console.log(`[AGENT] OLLAMA_URL: ${process.env.OLLAMA_URL || "<not set>"}`);
console.log(`[AGENT] AGENT_PORT: ${process.env.AGENT_PORT || "3000"}`);

// Keep process active and log heartbeat every 60 seconds
const heartbeat = setInterval(() => {
  console.log(`[AGENT] Heartbeat tick - ${new Date().toISOString()}`);
}, 60000);

function cleanExit(signal: string) {
  console.log(`[AGENT] Received ${signal}. Cleaning up and exiting cleanly...`);
  clearInterval(heartbeat);
  process.exit(0);
}

process.on("SIGTERM", () => cleanExit("SIGTERM"));
process.on("SIGINT", () => cleanExit("SIGINT"));
