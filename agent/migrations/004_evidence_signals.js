/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS evidence_signals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
      document_evidence_id UUID REFERENCES document_evidence(id) ON DELETE CASCADE,
      signal_type TEXT NOT NULL CHECK (signal_type IN (
        'DATE_RANGE', 
        'DURATION_STATEMENT', 
        'YEAR_COUNT', 
        'SEMESTER_COUNT', 
        'PROGRAM_LENGTH', 
        'GRADUATION_STATEMENT'
      )),
      raw_text TEXT NOT NULL,
      extracted_value TEXT,
      location_ref TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_signals_doc_type 
      ON evidence_signals(document_id, signal_type);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_signals_unique_match 
      ON evidence_signals(document_id, signal_type, raw_text);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS evidence_signals CASCADE;
  `);
};
