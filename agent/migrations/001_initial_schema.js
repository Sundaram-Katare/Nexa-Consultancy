/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // 1. Extensions
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // 2. Countries Table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS countries (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      is_accepted BOOLEAN DEFAULT true
    );
  `);

  // Seed 49 accepted countries
  pgm.sql(`
    INSERT INTO countries (name, is_accepted) VALUES
      ('American Samoa', true),
      ('Dominica', true),
      ('Lesotho', true),
      ('St. Kitts & Nevis', true),
      ('Anguilla', true),
      ('Falkland Islands', true),
      ('Liberia', true),
      ('St. Lucia', true),
      ('Antigua & Barbuda', true),
      ('Fiji', true),
      ('Malta', true),
      ('St. Vincent & the Grenadines', true),
      ('Australia', true),
      ('Gambia', true),
      ('Mauritius', true),
      ('Tanzania', true),
      ('Bahamas', true),
      ('Ghana', true),
      ('Montserrat', true),
      ('Trinidad & Tobago', true),
      ('Barbados', true),
      ('Gibraltar', true),
      ('New Zealand', true),
      ('Turks & Caicos Islands', true),
      ('Belize', true),
      ('Grenada', true),
      ('Nigeria', true),
      ('Uganda', true),
      ('Bermuda', true),
      ('Guam', true),
      ('Seychelles', true),
      ('United Kingdom', true),
      ('Botswana', true),
      ('Guyana', true),
      ('Sierra Leone', true),
      ('US Virgin Islands', true),
      ('British Virgin Islands', true),
      ('Ireland', true),
      ('Singapore', true),
      ('USA', true),
      ('United States', true),
      ('Canada', true),
      ('Jamaica', true),
      ('South Africa', true),
      ('Zambia', true),
      ('Cayman Islands', true),
      ('Kenya', true),
      ('St. Helena', true),
      ('Zimbabwe', true)
    ON CONFLICT (name) DO NOTHING;
  `);

  // 3. Sources Table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS sources (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      base_url TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    INSERT INTO sources (name, base_url, notes) VALUES
      ('scribd', 'https://www.scribd.com', 'Primary authorized target source'),
      ('slideshare', 'https://www.slideshare.net', 'Public slide/document source'),
      ('archive_org', 'https://archive.org', 'Internet Archive public academic records'),
      ('studocu', 'https://www.studocu.com', 'Public university study & academic repository'),
      ('zenodo_core', 'https://zenodo.org', 'Open access academic document repository')
    ON CONFLICT (name) DO NOTHING;
  `);

  // 4. Jobs Table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status TEXT NOT NULL CHECK (status IN ('QUEUED','RUNNING','PAUSED','BLOCKED','COMPLETED','FAILED')),
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      config JSONB NOT NULL
    );
  `);

  // 5. Search Tasks Table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS search_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
      country_id INT REFERENCES countries(id),
      source_id INT REFERENCES sources(id),
      institution TEXT,
      query_text TEXT NOT NULL,
      page INT DEFAULT 1,
      status TEXT CHECK (status IN ('QUEUED','RUNNING','PAUSED','BLOCKED','COMPLETED','FAILED')) DEFAULT 'QUEUED',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      CONSTRAINT unique_job_source_query_page UNIQUE (job_id, source_id, query_text, page)
    );
  `);

  // 6. Search History Table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS search_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      search_task_id UUID REFERENCES search_tasks(id) ON DELETE CASCADE,
      executed_at TIMESTAMPTZ DEFAULT now(),
      result_count INT,
      raw_response_meta JSONB
    );
  `);

  // 7. Documents Table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_id INT REFERENCES sources(id),
      source_document_id TEXT,
      canonical_url TEXT NOT NULL,
      title TEXT,
      country_id INT REFERENCES countries(id),
      institution TEXT,
      education_level TEXT,
      program TEXT,
      document_type TEXT,
      status TEXT DEFAULT 'PENDING',
      duplicate_of UUID REFERENCES documents(id) ON DELETE SET NULL,
      duplicate_reason TEXT,
      duplicate_confidence NUMERIC,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_source_doc_id 
      ON documents (source_id, source_document_id) 
      WHERE source_document_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_canonical_url 
      ON documents (canonical_url);
  `);

  // 8. Document Evidence Table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS document_evidence (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
      evidence_text TEXT,
      location_ref TEXT,
      extraction_method TEXT,
      extracted_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 9. Classifications Table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS classifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES documents(id) ON DELETE RESTRICT UNIQUE,
      classification TEXT CHECK (classification IN ('TWO_PLUS_YEARS','LESS_THAN_TWO_YEARS','NEEDS_REVIEW')),
      completed_years NUMERIC,
      duration_text TEXT,
      confidence NUMERIC,
      verification_status TEXT,
      model_used TEXT,
      classified_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 10. Checkpoints Table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
      search_task_id UUID REFERENCES search_tasks(id) ON DELETE CASCADE,
      page INT,
      document_index INT,
      status TEXT,
      saved_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 11. Errors Table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS errors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
      search_task_id UUID REFERENCES search_tasks(id) ON DELETE CASCADE,
      error_category TEXT,
      message TEXT,
      retry_count INT DEFAULT 0,
      occurred_at TIMESTAMPTZ DEFAULT now(),
      resolved BOOLEAN DEFAULT false
    );
  `);

  // 12. Audit Logs Table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT,
      entity_id UUID,
      action TEXT,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 13. Performance Indexes
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_search_tasks_job_status ON search_tasks(job_id, status);
    CREATE INDEX IF NOT EXISTS idx_documents_country_status ON documents(country_id, status);
    CREATE INDEX IF NOT EXISTS idx_classifications_classification ON classifications(classification);
    CREATE INDEX IF NOT EXISTS idx_errors_job_resolved ON errors(job_id, resolved);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS audit_logs CASCADE;
    DROP TABLE IF EXISTS errors CASCADE;
    DROP TABLE IF EXISTS checkpoints CASCADE;
    DROP TABLE IF EXISTS classifications CASCADE;
    DROP TABLE IF EXISTS document_evidence CASCADE;
    DROP TABLE IF EXISTS documents CASCADE;
    DROP TABLE IF EXISTS search_history CASCADE;
    DROP TABLE IF EXISTS search_tasks CASCADE;
    DROP TABLE IF EXISTS jobs CASCADE;
    DROP TABLE IF EXISTS sources CASCADE;
    DROP TABLE IF EXISTS countries CASCADE;
  `);
};
