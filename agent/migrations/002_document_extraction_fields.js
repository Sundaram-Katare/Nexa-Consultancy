/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // 1. Add extraction_attempts column
  pgm.sql(`
    ALTER TABLE documents 
    ADD COLUMN IF NOT EXISTS extraction_attempts INT DEFAULT 0;
  `);

  // 2. Add raw_metadata JSONB column if not present
  pgm.sql(`
    ALTER TABLE documents 
    ADD COLUMN IF NOT EXISTS raw_metadata JSONB;
  `);

  // 3. Update status CHECK constraint to strictly support PENDING, EXTRACTED, EXTRACTION_FAILED, CLASSIFIED
  pgm.sql(`
    ALTER TABLE documents 
    DROP CONSTRAINT IF EXISTS documents_status_check;

    ALTER TABLE documents 
    ADD CONSTRAINT documents_status_check 
    CHECK (status IN ('PENDING', 'EXTRACTED', 'EXTRACTION_FAILED', 'CLASSIFIED'));
  `);
  // 4. Add document_id to errors table if not present
  pgm.sql(`
    ALTER TABLE errors 
    ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES documents(id) ON DELETE CASCADE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE errors 
    DROP COLUMN IF EXISTS document_id;

    ALTER TABLE documents 
    DROP CONSTRAINT IF EXISTS documents_status_check;

    ALTER TABLE documents 
    DROP COLUMN IF EXISTS extraction_attempts;

    ALTER TABLE documents 
    DROP COLUMN IF EXISTS raw_metadata;
  `);
};
