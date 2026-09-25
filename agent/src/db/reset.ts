import { query, pool } from "./pool";

export async function resetDatabaseData() {
  console.log("Connecting to Supabase... Cleaning all data tables...");
  await query(`
    TRUNCATE TABLE 
      errors, 
      checkpoints, 
      classifications, 
      evidence_signals, 
      document_evidence, 
      documents, 
      search_history, 
      search_tasks, 
      job_metrics, 
      jobs, 
      institutions 
    CASCADE;
  `);
  console.log("✅ Reset Complete: All jobs, tasks, documents, and classifications have been reset to 0.");
  console.log("ℹ️  Note: 49 Accepted Countries and Source adapters remain preserved.");
  await pool.end();
}

if (require.main === module) {
  resetDatabaseData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Reset failed:", err);
      process.exit(1);
    });
}
