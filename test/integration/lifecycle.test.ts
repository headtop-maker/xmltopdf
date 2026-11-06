import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app';

const sample = readFileSync('test/fixtures/torg2.xml');

describe('stateless conversion lifecycle', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp());
  }, 180_000);

  afterAll(async () => {
    await close();
  });

  function convert() {
    return request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/octet-stream')
      .send(sample);
  }

  it('renders concurrent identical requests only once', async () => {
    const [first, second] = await Promise.all([convert(), convert()]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.artifactId).toBe(second.body.artifactId);
    expect(first.body.pdfSha256).toBe(second.body.pdfSha256);
    expect([first.body.cached, second.body.cached].sort()).toEqual([false, true]);
  }, 180_000);

  it('drops the link after a restart and re-renders the same bytes', async () => {
    const before = await convert();
    expect(before.status).toBe(201);
    const sha = before.body.pdfSha256;
    const link = new URL(before.body.downloadUrl).pathname;

    await close();
    ({ app, close } = await createTestApp());

    const gone = await request(app.getHttpServer()).get(link);
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe('NOT_FOUND');

    const after = await convert();
    expect(after.status).toBe(201);
    expect(after.body.cached).toBe(false);
    expect(after.body.pdfSha256).toBe(sha);
  }, 240_000);

  it('reports cache usage in readiness without a storage check', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.checks.cache.ok).toBe(true);
    expect(response.body.checks.storage).toBeUndefined();
    expect(response.body.checks.cache.detail).toMatch(/entries=\d+, bytes=\d+/);
  });
});
