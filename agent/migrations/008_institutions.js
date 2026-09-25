/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // 1. Create institutions table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS institutions (
      id SERIAL PRIMARY KEY,
      country_id INT REFERENCES countries(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      discovered_from_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
      status TEXT CHECK (status IN ('DISCOVERED', 'QUEUED', 'SEARCHED')) DEFAULT 'DISCOVERED',
      created_at TIMESTAMPTZ DEFAULT now(),
      CONSTRAINT unique_country_normalized_institution UNIQUE (country_id, normalized_name)
    );
  `);

  // 2. Add indexes for efficient queries
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_institutions_country_status 
    ON institutions(country_id, status);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS institutions CASCADE;
  `);
};
