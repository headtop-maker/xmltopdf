import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArtifactsService } from '../../src/artifacts/artifacts.service';
import { binaryParser, createTestApp } from '../helpers/test-app';

const sample = readFileSync('test/fixtures/torg2.xml');
const dataDir = path.resolve('./data/test');

describe('artifact lifecycle', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let close: (options?: { clean?: boolean }) => Promise<void>;
  let artifactId: string;
  let downloadUrl: string;
  let pdfSha256: string;

  beforeAll(async () => {
    ({ app, moduleRef, close } = await createTestApp({ clean: true }));
  }, 180_000);

  afterAll(async () => {
    await close({ clean: true });
  });

  it('creates an artifact with immutable bytes', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/octet-stream')
      .send(sample);
    expect(response.status).toBe(201);
    artifactId = response.body.artifactId;
    downloadUrl = response.body.downloadUrl;
    pdfSha256 = response.body.pdfSha256;
  }, 120_000);

  it('serves the same bytes after a full service restart', async () => {
    await close({ clean: false });
    ({ app, moduleRef, close } = await createTestApp({ clean: false }));

    const metadata = await request(app.getHttpServer())
      .get(`/api/v1/conversions/${artifactId}`)
      .set('X-API-Key', 'test-key');
    expect(metadata.status).toBe(200);
    expect(metadata.body.pdfSha256).toBe(pdfSha256);

    const download = await request(app.getHttpServer())
      .get(new URL(downloadUrl).pathname)
      .buffer(true)
      .parse(binaryParser);
    expect(download.status).toBe(200);
    expect(download.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(require('node:crypto').createHash('sha256').update(download.body).digest('hex')).toBe(pdfSha256);
  }, 180_000);

  it('removes orphan artifact directories on startup', async () => {
    await close({ clean: false });
    const orphan = path.join(dataDir, 'artifacts', 'orphan-without-db-row');
    await mkdir(orphan, { recursive: true });
    await writeFile(path.join(orphan, 'document.pdf'), 'not-a-pdf');
    ({ app, moduleRef, close } = await createTestApp({ clean: false }));

    const response = await request(app.getHttpServer())
      .get(`/api/v1/conversions/${artifactId}`)
      .set('X-API-Key', 'test-key');
    expect(response.status).toBe(200);

    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(path.join(dataDir, 'artifacts'));
    expect(entries).not.toContain('orphan-without-db-row');
  }, 180_000);

  it('expires artifacts and tokens without leaving a downloadable file', async () => {
    const artifacts = moduleRef.get(ArtifactsService);
    const base = {
      ownerId: 'test-owner',
      sourceXml: Buffer.from('<Файл/>'),
      pdf: Buffer.from('%PDF-1.4\n%%EOF\n'),
      document: {
        family: 'Torg2',
        formatVersion: '5.01',
        operatorVersion: 'torg2_05_01_01',
        titleIndex: 0,
        function: null,
        workflowFunction: null,
        knd: '1175014',
      },
      validation: {
        xsd: 'valid' as const,
        schemaRevision: 'test',
        schemaSha256: 'a'.repeat(64),
        businessRulesVersion: 'test',
        business: 'passed' as const,
        unmappedCount: 0,
      },
      warnings: [],
      templateVersion: 'test',
      rendererVersion: 'test',
      businessRulesVersion: 'test',
      businessStatus: 'passed',
      schemaRevision: 'test',
      schemaSha256: 'a'.repeat(64),
      signatureProfile: 'external-detached',
      signatureStatus: 'not-provided',
      pdfVersion: '1.4',
      pageCount: 1,
      ttlSeconds: 3600,
    };
    const artifact = await artifacts.create(base);
    const token = artifacts.issueToken(artifact);
    const resolved = await artifacts.resolveToken(token.token);
    expect(resolved.pdf.subarray(0, 5).toString()).toBe('%PDF-');

    await artifacts.expireArtifacts(new Date(Date.now() + 3_600_000));

    expect(() => artifacts.getOwned(artifact.id, 'test-owner')).toThrowError(/expired/i);
    await expect(artifacts.resolveToken(token.token)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const { existsSync } = await import('node:fs');
    expect(existsSync(path.join(dataDir, 'artifacts', artifact.id))).toBe(false);
  }, 60_000);

  it('deduplicates concurrent requests with the same Idempotency-Key', async () => {
    const key = 'parallel-key-1';
    const send = () =>
      request(app.getHttpServer())
        .post('/api/v1/conversions')
        .set('X-API-Key', 'test-key')
        .set('Content-Type', 'application/octet-stream')
        .set('Idempotency-Key', key)
        .send(sample);
    const [first, second] = await Promise.all([send(), send()]);
    expect([200, 201]).toContain(first.status);
    expect([200, 201]).toContain(second.status);
    expect(first.body.artifactId).toBe(second.body.artifactId);
  }, 180_000);
});
