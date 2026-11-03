export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('processing','ready','failed','expired')),
    source_key TEXT NOT NULL,
    pdf_key TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    pdf_sha256 TEXT NOT NULL,
    source_size INTEGER NOT NULL,
    pdf_size INTEGER NOT NULL,
    page_count INTEGER NOT NULL,
    pdf_version TEXT NOT NULL,
    document_json TEXT NOT NULL,
    validation_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    template_version TEXT NOT NULL,
    renderer_version TEXT NOT NULL,
    business_rules_version TEXT NOT NULL,
    business_status TEXT NOT NULL,
    schema_revision TEXT NOT NULL,
    schema_sha256 TEXT NOT NULL,
    signature_profile TEXT NOT NULL,
    signature_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_artifacts_owner ON artifacts(owner_id);
  CREATE INDEX IF NOT EXISTS idx_artifacts_expires ON artifacts(expires_at);

  CREATE TABLE IF NOT EXISTS download_tokens (
    token_hash TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tokens_artifact ON download_tokens(artifact_id);

  CREATE TABLE IF NOT EXISTS idempotency_records (
    owner_id TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, key_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_idempotency_artifact ON idempotency_records(artifact_id);

  CREATE TABLE IF NOT EXISTS resource_snapshots (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    revision TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
];
