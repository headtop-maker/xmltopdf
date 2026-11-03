import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binaryParser, clearArtifacts, createTestApp } from '../helpers/test-app';

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
  let moduleRef: TestingModule;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, moduleRef, close } = await createTestApp());
  }, 180_000);

  afterAll(async () => {
    await close();
  });

  it('converts the pinned windows-1251 TORG-2 sample into a stable PDF', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/octet-stream')
      .send(sample);

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`/api/v1/conversions/${response.body.artifactId}`);
    expect(response.body).toMatchObject({
      status: 'ready',
      document: {
        family: 'Torg2',
        formatVersion: '5.01',
        operatorVersion: 'torg2_05_01_01',
        titleIndex: 0,
        knd: '1175014',
      },
      validation: {
        xsd: 'valid',
        schemaRevision: 'DP_PRIRASXPRIN_1_994_01_05_01_04',
        schemaSha256: '6139596b95a3f4635ea0eab34fab33ce4e0f4fbebe4282fac043760884d36084',
        business: 'passed',
        unmappedCount: 0,
      },
      signingTarget: 'pdf',
      signatureProfile: 'external-detached',
      signatureStatus: 'not-provided',
    });
    expect(response.body.sourceSha256).toBe(
      '3e3edc1fb6e31dbdb226b51ccd360ae86c75f427d320623f6e64db13d9b237e9',
    );
    expect(response.body.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(response.body.pageCount).toBeGreaterThan(0);

    const downloadPath = new URL(response.body.downloadUrl).pathname;
    const first = await request(app.getHttpServer()).get(downloadPath).buffer(true).parse(binaryParser);
    const second = await request(app.getHttpServer()).get(downloadPath).buffer(true).parse(binaryParser);
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toContain('application/pdf');
    expect(first.headers['cache-control']).toContain('no-store');
    expect(first.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(Buffer.compare(first.body, second.body)).toBe(0);
    expect(first.headers.etag).toContain(response.body.pdfSha256);

    const text = pdfText(first.body);
    expect(text).toContain('УПД-ЭТрН-001');
    expect(text).toContain('Мука пшеничная хлебопекарная');
    expect(text).toContain('49 500,00');
    expect(text).toContain('47 025,00');
    expect(text).toContain('2 475,00');
    expect(text).toContain('225,00');
    expect(text).toContain('СУХОМЛИНОВ СЕРГЕЙ ПЕТРОВИЧ');
    expect(text).toContain('Подпись не проверялась');
    expect(text).not.toContain('SUKHOMLINOV');
    expect(text).not.toMatch(/подписано(?! не)/i);
  }, 120_000);

  it('returns metadata with a fresh download link for the owner only', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/xml')
      .send(sample);
    expect(created.status).toBe(201);

    const metadata = await request(app.getHttpServer())
      .get(`/api/v1/conversions/${created.body.artifactId}`)
      .set('X-API-Key', 'test-key');
    expect(metadata.status).toBe(200);
    expect(metadata.body.artifactId).toBe(created.body.artifactId);
    expect(metadata.body.downloadUrl).not.toBe(created.body.downloadUrl);

    const foreign = await request(app.getHttpServer())
      .get(`/api/v1/conversions/${created.body.artifactId}`)
      .set('X-API-Key', 'other-key');
    expect(foreign.status).toBe(404);

    const unauthenticated = await request(app.getHttpServer()).get(
      `/api/v1/conversions/${created.body.artifactId}`,
    );
    expect(unauthenticated.status).toBe(401);
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

  it('deduplicates by Idempotency-Key and conflicts on different bytes', async () => {
    await clearArtifacts(moduleRef);
    const key = 'sample-key-1';
    const first = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/octet-stream')
      .set('Idempotency-Key', key)
      .send(sample);
    expect(first.status).toBe(201);

    const repeat = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/octet-stream')
      .set('Idempotency-Key', key)
      .send(sample);
    expect(repeat.status).toBe(201);
    expect(repeat.body.artifactId).toBe(first.body.artifactId);

    const conflict = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/xml')
      .set('Idempotency-Key', key)
      .send(utf8Variant((text) => text));
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  }, 180_000);

  it('reports only implemented formats and enforces the body limit', async () => {
    const formats = await request(app.getHttpServer())
      .get('/api/v1/formats')
      .set('X-API-Key', 'test-key');
    expect(formats.status).toBe(200);
    expect(formats.body.formats).toHaveLength(4);
    const torg2 = formats.body.formats.find((item: { family: string }) => item.family === 'Torg2');
    expect(torg2).toMatchObject({ titleIndex: 0, implemented: true });
    const upd = formats.body.formats.find((item: { family: string }) => item.family === 'UniversalTransferDocument');
    expect(upd).toMatchObject({
      titleIndex: 0,
      implemented: true,
      supportedFunctions: ['СЧФ', 'ДОП', 'СЧФДОП', 'СвРК', 'СвЗК'],
    });
    const updBuyer = formats.body.formats.find(
      (item: { family: string; titleIndex: number }) =>
        item.family === 'UniversalTransferDocument' && item.titleIndex === 1,
    );
    expect(updBuyer).toMatchObject({ implemented: true, knd: '1115132' });
    const torg2Seller = formats.body.formats.find(
      (item: { family: string; titleIndex: number }) => item.family === 'Torg2' && item.titleIndex === 1,
    );
    expect(torg2Seller).toMatchObject({ implemented: true, knd: '1175015' });

    const oversize = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x20);
    const response = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/octet-stream')
      .send(oversize);
    expect(response.status).toBe(413);
    expect(response.body.code).toBe('XML_LIMIT_EXCEEDED');
  }, 120_000);

  it('returns 404 for unknown download tokens', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/downloads/not-a-real-token');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
