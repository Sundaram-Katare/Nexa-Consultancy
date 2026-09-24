/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE classifications 
    ADD COLUMN IF NOT EXISTS reasoning TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE classifications 
    DROP COLUMN IF EXISTS reasoning;
  `);
};
