import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config';
import { AppError, errors } from '../common/errors';
import { sha256Hex } from '../common/hash';
import { logger } from '../common/logger';
import { MIGRATIONS } from './migrations';
import type { Artifact, ArtifactDocument, ArtifactValidation, ArtifactWarning, CreateArtifactInput } from './artifact.types';

interface ArtifactRow {
  id: string;
  owner_id: string;
  state: 'processing' | 'ready' | 'failed' | 'expired';
  source_key: string;
  pdf_key: string;
  source_sha256: string;
  pdf_sha256: string;
  source_size: number;
  pdf_size: number;
  page_count: number;
  pdf_version: string;
  document_json: string;
  validation_json: string;
  warnings_json: string;
  template_version: string;
  renderer_version: string;
  business_rules_version: string;
  business_status: string;
  schema_revision: string;
  schema_sha256: string;
  signature_profile: string;
  signature_status: string;
  created_at: string;
  expires_at: string;
}

const TOMBSTONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class ArtifactsService implements OnModuleInit, OnModuleDestroy {
  private db!: Database.Database;
  private readonly artifactsDir: string;
  private readonly tmpDir: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.artifactsDir = path.join(config.dataDir, 'artifacts');
    this.tmpDir = path.join(config.dataDir, 'tmp');
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.artifactsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
    const dbDir = path.join(this.config.dataDir, 'sqlite');
    await mkdir(dbDir, { recursive: true, mode: 0o700 });
    this.db = new Database(path.join(dbDir, 'app.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
    await this.reconcile();
    await this.expireArtifacts();
    this.timer = setInterval(() => {
      this.expireArtifacts().catch((error) => logger.error('artifacts.expire.failed', { message: (error as Error).message }));
    }, 5 * 60 * 1000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.db?.close();
  }

  private migrate(): void {
    const current = this.db.pragma('user_version', { simple: true }) as number;
    for (let version = current; version < MIGRATIONS.length; version += 1) {
      this.db.exec(MIGRATIONS[version]);
      this.db.pragma(`user_version = ${version + 1}`);
    }
  }

  /**
   * Removes orphan temp directories, marks artifacts whose files disappeared as
   * failed, and deletes directories that have no database row (crash between
   * rename and commit).
   */
  private async reconcile(): Promise<void> {
    for (const entry of await readdir(this.tmpDir).catch(() => [])) {
      await rm(path.join(this.tmpDir, entry), { recursive: true, force: true }).catch(() => undefined);
    }
    const rows = this.db.prepare('SELECT id, pdf_key, source_key FROM artifacts').all() as {
      id: string;
      pdf_key: string;
      source_key: string;
    }[];
    const known = new Set(rows.map((row) => row.id));
    for (const entry of await readdir(this.artifactsDir).catch(() => [])) {
      if (!known.has(entry)) {
        await rm(path.join(this.artifactsDir, entry), { recursive: true, force: true }).catch(() => undefined);
      }
    }
    for (const row of rows) {
      const pdfPath = path.join(this.artifactsDir, row.pdf_key);
      const sourcePath = path.join(this.artifactsDir, row.source_key);
      if (!existsSync(pdfPath) || !existsSync(sourcePath)) {
        this.db.prepare("UPDATE artifacts SET state = 'failed' WHERE id = ?").run(row.id);
        logger.warn('artifacts.reconcile.missing', { artifactId: row.id });
      }
    }
    this.db
      .prepare("UPDATE artifacts SET state = 'expired' WHERE state = 'ready' AND expires_at <= ?")
      .run(new Date().toISOString());
  }

  private rowToArtifact(row: ArtifactRow): Artifact {
    return {
      id: row.id,
      ownerId: row.owner_id,
      state: row.state === 'processing' ? 'failed' : row.state,
      sourceSha256: row.source_sha256,
      pdfSha256: row.pdf_sha256,
      sourceSize: row.source_size,
      pdfSize: row.pdf_size,
      pageCount: row.page_count,
      pdfVersion: row.pdf_version,
      document: JSON.parse(row.document_json) as ArtifactDocument,
      validation: JSON.parse(row.validation_json) as ArtifactValidation,
      warnings: JSON.parse(row.warnings_json) as ArtifactWarning[],
      templateVersion: row.template_version,
      rendererVersion: row.renderer_version,
      businessRulesVersion: row.business_rules_version,
      businessStatus: row.business_status,
      schemaRevision: row.schema_revision,
      schemaSha256: row.schema_sha256,
      signatureProfile: row.signature_profile,
      signatureStatus: row.signature_status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async create(input: CreateArtifactInput): Promise<Artifact> {
    const id = randomUUID();
    const tempDir = path.join(this.tmpDir, `art-${id}`);
    const finalDir = path.join(this.artifactsDir, id);
    const sourceKey = path.join(id, 'source.xml');
    const pdfKey = path.join(id, 'document.pdf');
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + input.ttlSeconds * 1000);

    try {
      await mkdir(tempDir, { recursive: true, mode: 0o700 });
      await writeFileDurable(path.join(tempDir, 'source.xml'), input.sourceXml);
      await writeFileDurable(path.join(tempDir, 'document.pdf'), input.pdf);
      await rename(tempDir, finalDir);
    } catch (cause) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      throw errors.storage('Could not persist the artifact files');
    }

    const document: ArtifactDocument = input.document;
    try {
      this.db
        .prepare(
          `INSERT INTO artifacts (
            id, owner_id, state, source_key, pdf_key, source_sha256, pdf_sha256, source_size, pdf_size,
            page_count, pdf_version, document_json, validation_json, warnings_json, template_version,
            renderer_version, business_rules_version, business_status, schema_revision, schema_sha256,
            signature_profile, signature_status, created_at, expires_at
          ) VALUES (
            @id, @owner_id, 'ready', @source_key, @pdf_key, @source_sha256, @pdf_sha256, @source_size, @pdf_size,
            @page_count, @pdf_version, @document_json, @validation_json, @warnings_json, @template_version,
            @renderer_version, @business_rules_version, @business_status, @schema_revision, @schema_sha256,
            @signature_profile, @signature_status, @created_at, @expires_at
          )`,
        )
        .run({
          id,
          owner_id: input.ownerId,
          source_key: sourceKey,
          pdf_key: pdfKey,
          source_sha256: sha256Hex(input.sourceXml),
          pdf_sha256: sha256Hex(input.pdf),
          source_size: input.sourceXml.length,
          pdf_size: input.pdf.length,
          page_count: input.pageCount,
          pdf_version: input.pdfVersion,
          document_json: JSON.stringify(document),
          validation_json: JSON.stringify(input.validation),
          warnings_json: JSON.stringify(input.warnings),
          template_version: input.templateVersion,
          renderer_version: input.rendererVersion,
          business_rules_version: input.businessRulesVersion,
          business_status: input.businessStatus,
          schema_revision: input.schemaRevision,
          schema_sha256: input.schemaSha256,
          signature_profile: input.signatureProfile,
          signature_status: input.signatureStatus,
          created_at: createdAt.toISOString(),
          expires_at: expiresAt.toISOString(),
        });
    } catch (cause) {
      await rm(finalDir, { recursive: true, force: true }).catch(() => undefined);
      throw errors.storage('Could not record artifact metadata');
    }

    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as ArtifactRow;
    return this.rowToArtifact(row);
  }

  getOwned(id: string, ownerId: string): Artifact {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as ArtifactRow | undefined;
    if (!row || row.owner_id !== ownerId) {
      throw errors.notFound('Artifact not found');
    }
    if (row.state === 'expired' || Date.parse(row.expires_at) <= Date.now()) {
      throw new AppError(410, 'ARTIFACT_EXPIRED', 'The artifact has expired; request a new conversion');
    }
    if (row.state !== 'ready') {
      throw errors.notFound('Artifact not found');
    }
    return this.rowToArtifact(row);
  }

  async readPdf(artifact: Artifact): Promise<Buffer> {
    const row = this.db.prepare('SELECT pdf_key FROM artifacts WHERE id = ?').get(artifact.id) as
      | { pdf_key: string }
      | undefined;
    if (!row) throw errors.notFound('Artifact not found');
    try {
      return await readFile(path.join(this.artifactsDir, row.pdf_key));
    } catch (cause) {
      throw new AppError(500, 'CONVERSION_FAILED', 'The stored PDF is not readable', { cause });
    }
  }

  issueToken(artifact: Artifact): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const artifactExpiry = Date.parse(artifact.expiresAt);
    const expiresAt = new Date(Math.min(now + this.config.downloadTokenTtlSeconds * 1000, artifactExpiry)).toISOString();
    this.db
      .prepare('INSERT INTO download_tokens (token_hash, artifact_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256Hex(token), artifact.id, new Date(now).toISOString(), expiresAt);
    return { token, expiresAt };
  }

  async resolveToken(token: string): Promise<{ artifact: Artifact; pdf: Buffer }> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw errors.notFound('Download link is invalid');
    const row = this.db
      .prepare(
        `SELECT t.expires_at AS token_expires_at, a.* FROM download_tokens t
         JOIN artifacts a ON a.id = t.artifact_id WHERE t.token_hash = ?`,
      )
      .get(sha256Hex(token)) as (ArtifactRow & { token_expires_at: string }) | undefined;
    if (!row) throw errors.notFound('Download link is invalid');
    if (Date.parse(row.token_expires_at) <= Date.now()) throw errors.notFound('Download link is invalid');
    if (row.state !== 'ready' || Date.parse(row.expires_at) <= Date.now()) {
      throw errors.notFound('Download link is invalid');
    }
    const artifact = this.rowToArtifact(row);
    try {
      const pdf = await readFile(path.join(this.artifactsDir, row.pdf_key));
      return { artifact, pdf };
    } catch {
      throw errors.notFound('Download link is invalid');
    }
  }

  findIdempotent(ownerId: string, keyHash: string): { fingerprint: string; artifactId: string } | undefined {
    const row = this.db
      .prepare('SELECT fingerprint, artifact_id, expires_at FROM idempotency_records WHERE owner_id = ? AND key_hash = ?')
      .get(ownerId, keyHash) as { fingerprint: string; artifact_id: string; expires_at: string } | undefined;
    if (!row) return undefined;
    if (Date.parse(row.expires_at) <= Date.now()) {
      this.db
        .prepare('DELETE FROM idempotency_records WHERE owner_id = ? AND key_hash = ?')
        .run(ownerId, keyHash);
      return undefined;
    }
    return { fingerprint: row.fingerprint, artifactId: row.artifact_id };
  }

  saveIdempotent(ownerId: string, keyHash: string, fingerprint: string, artifactId: string, expiresAt: string): void {
    this.db
      .prepare(
        `INSERT INTO idempotency_records (owner_id, key_hash, fingerprint, artifact_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, key_hash) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           artifact_id = excluded.artifact_id,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      )
      .run(ownerId, keyHash, fingerprint, artifactId, new Date().toISOString(), expiresAt);
  }

  async expireArtifacts(now = new Date()): Promise<number> {
    const rows = this.db
      .prepare("SELECT id, source_key, pdf_key FROM artifacts WHERE state = 'ready' AND expires_at <= ?")
      .all(now.toISOString()) as { id: string; source_key: string; pdf_key: string }[];
    for (const row of rows) {
      await rm(path.join(this.artifactsDir, row.id), { recursive: true, force: true }).catch(() => undefined);
      this.db.prepare("UPDATE artifacts SET state = 'expired' WHERE id = ?").run(row.id);
      this.db.prepare('DELETE FROM download_tokens WHERE artifact_id = ?').run(row.id);
    }
    const cutoff = new Date(now.getTime() - TOMBSTONE_RETENTION_MS).toISOString();
    this.db.prepare("DELETE FROM idempotency_records WHERE expires_at <= ?").run(now.toISOString());
    const purged = this.db
      .prepare("DELETE FROM artifacts WHERE state = 'expired' AND expires_at <= ?")
      .run(cutoff);
    return rows.length + purged.changes;
  }

  async storageStats(): Promise<{ artifacts: number; bytes: number }> {
    const rows = this.db.prepare('SELECT source_size, pdf_size FROM artifacts').all() as {
      source_size: number;
      pdf_size: number;
    }[];
    return {
      artifacts: rows.length,
      bytes: rows.reduce((total, row) => total + row.source_size + row.pdf_size, 0),
    };
  }

  recordResourceSnapshot(id: string, kind: string, revision: string, sha256: string, resourcePath: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO resource_snapshots (id, kind, revision, sha256, path, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, kind, revision, sha256, resourcePath, new Date().toISOString());
  }

  /** Test helper: drops all artifacts and their files. */
  async clearAll(): Promise<void> {
    await rm(this.artifactsDir, { recursive: true, force: true }).catch(() => undefined);
    await mkdir(this.artifactsDir, { recursive: true, mode: 0o700 });
    this.db.exec('DELETE FROM download_tokens; DELETE FROM idempotency_records; DELETE FROM artifacts;');
  }
}

async function writeFileDurable(filePath: string, data: Buffer): Promise<void> {
  const handle = await open(filePath, 'w', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
