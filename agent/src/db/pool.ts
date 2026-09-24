import { Pool, PoolConfig, QueryResult, QueryResultRow } from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://nexa_user:nexa_secure_password_123@localhost:5433/nexa_consultancy_db";

const isProduction = process.env.NODE_ENV === "production";
const isRemoteDb =
  connectionString.includes("supabase.co") ||
  connectionString.includes("supabase.com") ||
  connectionString.includes("aws-") ||
  connectionString.includes("sslmode=require");

const poolConfig: PoolConfig = {
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: isRemoteDb
    ? {
        rejectUnauthorized: false,
      }
    : undefined,
};

export const pool = new Pool(poolConfig);

pool.on("error", (err) => {
  console.error("[DB] Unexpected error on idle database client:", err.message);
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (process.env.DEBUG_SQL === "true") {
      console.log(`[DB] Executed query in ${duration}ms:`, { text, rows: res.rowCount });
    }
    return res;
  } catch (err: any) {
    console.error(`[DB] Query failed: ${text}`, err.message);
    throw err;
  }
}

export async function getClient() {
  return await pool.connect();
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const res = await query("SELECT 1 as healthy");
    return res.rows[0]?.healthy === 1;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export default pool;
