import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app';

const sample = readFileSync('test/fixtures/torg2.xml');

describe('owner quota', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  const previous = process.env.RATE_LIMIT_PER_MINUTE;

  beforeAll(async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '2';
    ({ app, close } = await createTestApp());
  }, 180_000);

  afterAll(async () => {
    await close();
    if (previous === undefined) delete process.env.RATE_LIMIT_PER_MINUTE;
    else process.env.RATE_LIMIT_PER_MINUTE = previous;
  });

  it('returns 429 TOO_MANY_REQUESTS with Retry-After after the owner quota', async () => {
    const send = () =>
      request(app.getHttpServer())
        .post('/api/v1/conversions')
        .set('X-API-Key', 'test-key')
        .set('Content-Type', 'application/octet-stream')
        .send(sample);

    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    const denied = await send();
    expect(denied.status).toBe(429);
    expect(denied.body.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);

    const otherOwner = await request(app.getHttpServer())
      .post('/api/v1/conversions')
      .set('X-API-Key', 'other-key')
      .set('Content-Type', 'application/octet-stream')
      .send(sample);
    expect(otherOwner.status).toBe(201);
  }, 120_000);
});
