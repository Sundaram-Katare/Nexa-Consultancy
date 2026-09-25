/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS job_metrics (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      duration_ms INT,
      items_processed INT DEFAULT 0,
      memory_heap_used_mb NUMERIC,
      recorded_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_job_metrics_job ON job_metrics(job_id, stage);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS job_metrics CASCADE;
  `);
};
