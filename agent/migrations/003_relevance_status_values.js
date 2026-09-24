/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Update status CHECK constraint to support CLASSIFIED_PENDING, IRRELEVANT, NEEDS_RELEVANCE_REVIEW
  pgm.sql(`
    ALTER TABLE documents 
    DROP CONSTRAINT IF EXISTS documents_status_check;

    ALTER TABLE documents 
    ADD CONSTRAINT documents_status_check 
    CHECK (status IN (
      'PENDING',
      'EXTRACTED',
      'EXTRACTION_FAILED',
      'CLASSIFIED_PENDING',
      'IRRELEVANT',
      'NEEDS_RELEVANCE_REVIEW',
      'CLASSIFIED'
    ));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE documents 
    DROP CONSTRAINT IF EXISTS documents_status_check;

    ALTER TABLE documents 
    ADD CONSTRAINT documents_status_check 
    CHECK (status IN ('PENDING', 'EXTRACTED', 'EXTRACTION_FAILED', 'CLASSIFIED'));
  `);
};
