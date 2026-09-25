/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // 1. Add requires_human_intervention flag to errors
  pgm.sql(`
    ALTER TABLE errors 
    ADD COLUMN IF NOT EXISTS requires_human_intervention BOOLEAN DEFAULT false;
  `);

  // 2. Add details JSONB column to errors
  pgm.sql(`
    ALTER TABLE errors 
    ADD COLUMN IF NOT EXISTS details JSONB;
  `);

  // 3. Index for human intervention error filtering
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_errors_human_intervention 
    ON errors(requires_human_intervention) 
    WHERE requires_human_intervention = true;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_errors_human_intervention;

    ALTER TABLE errors 
    DROP COLUMN IF EXISTS details;

    ALTER TABLE errors 
    DROP COLUMN IF EXISTS requires_human_intervention;
  `);
};
