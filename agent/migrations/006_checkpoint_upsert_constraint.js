/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // 1. Add stage column to checkpoints if not present
  pgm.sql(`
    ALTER TABLE checkpoints 
    ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'SEARCH';
  `);

  // 2. Create unique index on (job_id, COALESCE(search_task_id, '00000000-0000-0000-0000-000000000000'::uuid), stage)
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_checkpoints_job_task_stage 
    ON checkpoints(job_id, COALESCE(search_task_id, '00000000-0000-0000-0000-000000000000'::uuid), stage);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_checkpoints_job_task_stage;

    ALTER TABLE checkpoints 
    DROP COLUMN IF EXISTS stage;
  `);
};
