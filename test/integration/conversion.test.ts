import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binaryParser, createTestApp } from '../helpers/test-app';

const sample = readFileSync('test/fixtures/torg2.xml');

function utf8Variant(mutate: (text: string) => string): Buffer {
  const text = new TextDecoder('windows-1251').decode(sample);
  return Buffer.from(mutate(text.replace('encoding="windows-1251"', 'encoding="utf-8"')), 'utf8');
}

function pdfText(pdf: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'xmltopdf-'));
  const file = path.join(dir, 'document.pdf');
  writeFileSync(file, pdf);
  const result = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`pdftotext failed: ${result.stderr}`);
  return result.stdout.replace(/\u00a0/g, ' ');
}

describe('conversion API', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp());
  }, 180_000);

  afterAll(async () => {
    await close();
  });

  function convert(buffer: Buffer, contentType = 'application/octet-stream') {
    return request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', contentType)
      .send(buffer);
  }

  async function download(body: { downloadUrl: string }) {
    return request(app.getHttpServer())
      .get(new URL(body.downloadUrl).pathname)
      .buffer(true)
      .parse(binaryParser);
  }

  it('returns metadata with a working download link', async () => {
    const created = await convert(sample);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'ready',
      document: { family: 'Torg2', titleIndex: 0, knd: '1175014', function: null },
      validation: {
        xsd: 'valid',
        schemaRevision: 'DP_PRIRASXPRIN_1_994_01_05_01_04',
        business: 'passed',
        unmappedCount: 0,
      },
      signingTarget: 'pdf',
      signatureProfile: 'external-detached',
      signatureStatus: 'not-provided',
      cached: false,
    });
    expect(created.body.artifactId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.body.sourceSha256).toBe(
      '3e3edc1fb6e31dbdb226b51ccd360ae86c75f427d320623f6e64db13d9b237e9',
    );
    expect(created.body.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(created.body.downloadUrl).toContain('/api/v1/downloads/');
    expect(created.body.downloadToken).toMatch(/^[A-Za-z0-9_-]{20,100}$/);
    expect(new URL(created.body.downloadUrl).pathname.split('/').pop()).toBe(created.body.downloadToken);
    expect(created.body.downloadToken).not.toBe(created.body.artifactId);
    expect(Date.parse(created.body.expiresAt)).toBeGreaterThan(Date.now());

    const response = await download(created.body);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toMatch(/attachment; filename="torg2-[0-9a-f]{8}\.pdf"/);
    expect(response.headers.etag).toBe(`"${created.body.pdfSha256}"`);

    const pdf = response.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBe(created.body.pdfSizeBytes);

    const text = pdfText(pdf);
    expect(text).toContain('УПД-ЭТрН-001');
    // The goods column matches the SBIS width, so long names wrap inside the cell.
    expect(text).toContain('Мука пшеничная');
    expect(text).toContain('хлебопекарная');
    expect(text).toContain('49500.00');
    expect(text).not.toContain('Подпись не проверялась');
    expect(text).not.toMatch(/подписано(?! не)/i);
  }, 120_000);

  it('reuses the cached artifact for identical bytes', async () => {
    const first = await convert(sample);
    const second = await convert(sample);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.cached).toBe(true);
    expect(second.body.artifactId).toBe(first.body.artifactId);
    expect(second.body.pdfSha256).toBe(first.body.pdfSha256);

    const a = await download(first.body);
    const b = await download(second.body);
    expect(Buffer.compare(a.body as Buffer, b.body as Buffer)).toBe(0);
  }, 120_000);

  it('renders different content into a new artifact', async () => {
    const different = utf8Variant((text) => text.replace('УПД-ЭТрН-001', 'УПД-ЭТрН-002'));
    const response = await convert(different, 'application/xml');
    expect(response.status).toBe(201);
    expect(response.body.cached).toBe(false);
    const base = await convert(sample);
    expect(response.body.pdfSha256).not.toBe(base.body.pdfSha256);
  }, 120_000);

  it('enforces authentication, media types and empty bodies', async () => {
    const noKey = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('Content-Type', 'application/octet-stream')
      .send(sample);
    expect(noKey.status).toBe(401);
    expect(noKey.body.code).toBe('UNAUTHORIZED');

    const json = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/json')
      .send({ document: 'not xml' });
    expect(json.status).toBe(415);
    expect(json.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const empty = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(0));
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('EMPTY_BODY');
  });

  it('rejects unsafe XML, wrong titles and schema violations with distinct codes', async () => {
    const xxe = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/xml')
      .send(
        Buffer.from(
          '<?xml version="1.0"?><!DOCTYPE Файл [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Файл>&xxe;</Файл>',
          'utf8',
        ),
      );
    expect(xxe.status).toBe(400);
    expect(xxe.body.code).toBe('UNSAFE_XML');

    const otherTitle = utf8Variant((text) => text.replace('КНД="1175014"', 'КНД="1175016"'));
    const titleResponse = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/xml')
      .send(otherTitle);
    expect(titleResponse.status).toBe(422);
    expect(titleResponse.body.code).toBe('UNSUPPORTED_TITLE');

    const schemaBreach = utf8Variant((text) => text.replace(/\sНаимДокОпр="[^"]*"/, ''));
    const schemaResponse = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/xml')
      .send(schemaBreach);
    expect(schemaResponse.status).toBe(422);
    expect(schemaResponse.body.code).toBe('XSD_VALIDATION_FAILED');
    expect(JSON.stringify(schemaResponse.body)).not.toContain('/tmp/');
    expect(JSON.stringify(schemaResponse.body)).not.toContain('xml-');
  });

  it('enforces the body limit', async () => {
    const oversize = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x20);
    const response = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/octet-stream')
      .send(oversize);
    expect(response.status).toBe(413);
    expect(response.body.code).toBe('XML_LIMIT_EXCEEDED');
  }, 120_000);

  it('does not expose a formats catalogue or artifact metadata', async () => {
    const formats = await request(app.getHttpServer())
      .get('/api/v1/formats')
      .set('X-API-Key', 'test-key');
    expect(formats.status).toBe(404);

    const artifact = await request(app.getHttpServer())
      .get('/api/v1/conversions/00000000-0000-4000-8000-000000000000')
      .set('X-API-Key', 'test-key');
    expect(artifact.status).toBe(404);
  });

  it('returns 404 for unknown download tokens', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/downloads/not-a-real-token');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
