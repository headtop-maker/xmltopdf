import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binaryParser, createTestApp } from '../helpers/test-app';

const fixtures = {
  schfdop: readFileSync('test/fixtures/upd-schfdop.xml'),
  schf: readFileSync('test/fixtures/upd-schf.xml'),
  dop: readFileSync('test/fixtures/upd-dop.xml'),
};

function asUtf8(buffer: Buffer): string {
  return buffer.toString('utf8');
}

function pdfText(pdf: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'xmltopdf-upd-'));
  const file = path.join(dir, 'document.pdf');
  writeFileSync(file, pdf);
  const result = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`pdftotext failed: ${result.stderr}`);
  return result.stdout.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
}

function sendUpd(app: INestApplication, body: Buffer) {
  return request(app.getHttpServer())
    .post('/api/v1/conversions')
    .set('X-API-Key', 'test-key')
    .set('Content-Type', 'application/octet-stream')
    .send(body);
}

async function download(app: INestApplication, body: { downloadUrl: string }): Promise<Buffer> {
  const response = await request(app.getHttpServer())
    .get(new URL(body.downloadUrl).pathname)
    .buffer(true)
    .parse(binaryParser);
  expect(response.status).toBe(200);
  return response.body as Buffer;
}

describe('UPD title 0 conversions', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp());
  }, 180_000);

  afterAll(async () => {
    await close();
  });

  function convert(buffer: Buffer) {
    return sendUpd(app, buffer);
  }

  it('prints a СЧФДОП as a universal transfer document with invoice and shipment data', async () => {
    const response = await convert(fixtures.schfdop);
    expect(response.status).toBe(201);
    expect(response.body.document.family).toBe('UniversalTransferDocument');
    expect(response.body.document.function).toBe('СЧФДОП');
    expect(response.body.document.titleIndex).toBe(0);
    expect(response.body.document.knd).toBe('1115131');
    expect(response.body.validation.schemaRevision).toBe('ON_NSCHFDOPPR_1_997_01_05_03_05');
    expect(response.body.validation.business).toBe('passed');
    expect(response.body.validation.unmappedCount).toBe(0);

    const text = pdfText(await download(app, response.body));
    expect(text).toContain('Универсальный передаточный документ');
    expect(text).toContain('СИНТ-01-01');
    expect(text).toContain('Иванов Иван Иванович');
    expect(text).toContain('Товар синтетический');
    expect(text).toContain('Услуга синтетическая');
    expect(text).toContain('22%');
    expect(text).toContain('7 790,24');
    expect(text).toContain('9 504,09');
    expect(text).toContain('1 713,85');
    expect(text).toContain('10 790,24');
    expect(text).toContain('12 804,09');
    expect(text).toContain('Товары переданы');
    expect(text).toContain('Подпись не проверялась');
    expect(text).not.toMatch(/\bподписано\b(?! не)/i);
  }, 120_000);

  it('prints a СЧФ as an invoice without a shipment section', async () => {
    const response = await convert(fixtures.schf);
    expect(response.status).toBe(201);
    expect(response.body.document.function).toBe('СЧФ');
    const text = pdfText(await download(app, response.body));
    expect(text).toContain('Счёт-фактура');
    expect(text).toContain('НОМЕР СЧЁТА-ФАКТУРЫ');
    expect(text).not.toContain('СВЕДЕНИЯ О ПЕРЕДАЧЕ');
    expect(text).not.toContain('Товары переданы');
  }, 120_000);

  it('prints a ДОП as a shipment document, not as an invoice', async () => {
    const response = await convert(fixtures.dop);
    expect(response.status).toBe(201);
    expect(response.body.document.function).toBe('ДОП');
    const text = pdfText(await download(app, response.body));
    expect(text).toContain('Документ об отгрузке товаров');
    expect(text).toContain('СВЕДЕНИЯ О ПЕРЕДАЧЕ');
    expect(text).toContain('НОМЕР ДОКУМЕНТА');
    expect(text).not.toContain('НОМЕР СЧЁТА-ФАКТУРЫ');
  }, 120_000);

  it('rejects unknown and missing functions with UNSUPPORTED_FUNCTION', async () => {
    const unknown = asUtf8(fixtures.schfdop).replace('Функция="СЧФДОП"', 'Функция="СвИС"');
    const unsupported = await convert(Buffer.from(unknown, 'utf8'));
    expect(unsupported.status).toBe(422);
    expect(unsupported.body.code).toBe('UNSUPPORTED_FUNCTION');

    const missing = asUtf8(fixtures.schfdop).replace(' Функция="СЧФДОП"', '');
    const missingResponse = await convert(Buffer.from(missing, 'utf8'));
    expect(missingResponse.status).toBe(422);
    expect(missingResponse.body.code).toBe('UNSUPPORTED_FUNCTION');
  }, 120_000);

  it('renders the one-page Saby layout when UPD_SABY_LAYOUT is enabled', async () => {
    const previous = process.env.UPD_SABY_LAYOUT;
    process.env.UPD_SABY_LAYOUT = 'true';
    try {
      const response = await convert(fixtures.schfdop);
      expect(response.status).toBe(201);
      expect(response.body.pageCount).toBe(1);
      const text = pdfText(await download(app, response.body));
      expect(text).toContain('Приложение N 1');
      expect(text).toContain('Счет-фактура');
      expect(text).not.toContain('Подпись не проверялась');
    } finally {
      if (previous === undefined) delete process.env.UPD_SABY_LAYOUT;
      else process.env.UPD_SABY_LAYOUT = previous;
    }
  }, 180_000);

  it('reports arithmetic mismatches as warnings and prints the source values unchanged', async () => {
    const broken = asUtf8(fixtures.schfdop).replace('СтТовБезНДС="7790.24"', 'СтТовБезНДС="7800.00"');
    const response = await convert(Buffer.from(broken, 'utf8'));
    expect(response.status).toBe(201);
    expect(response.body.validation.business).toBe('passed-with-warnings');
    expect(response.body.warnings.some((w: { code: string }) => w.code === 'ARITHMETIC_AMOUNT_MISMATCH')).toBe(true);
    const text = pdfText(await download(app, response.body));
    expect(text).toContain('7 800,00');
  }, 120_000);
});

describe('UPD commission functions', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp());
  }, 180_000);

  afterAll(async () => {
    await close();
  });

  function convert(file: string) {
    return sendUpd(app, readFileSync(file));
  }

  it('prints СвРК as a commission-sale statement, not as an invoice', async () => {
    const response = await convert('test/fixtures/upd-svrk.xml');
    expect(response.status).toBe(201);
    expect(response.body.document.function).toBe('СвРК');
    expect(response.body.validation.business).toBe('passed');
    expect(response.body.validation.unmappedCount).toBe(0);
    const text = pdfText(await download(app, response.body));
    expect(text).toContain('Сведения о факте реализации');
    expect(text).toContain('Это не счёт-фактура и не УПД');
    expect(text).toContain('Комитент (принципал)');
    expect(text).toContain('ООО «Комитент Пример»');
    expect(text).not.toContain('НОМЕР СЧЁТА-ФАКТУРЫ');
  }, 120_000);

  it('prints СвЗК as a commission-purchase statement, not as an invoice', async () => {
    const response = await convert('test/fixtures/upd-svzk.xml');
    expect(response.status).toBe(201);
    expect(response.body.document.function).toBe('СвЗК');
    const text = pdfText(await download(app, response.body));
    expect(text).toContain('Сведения о факте закупки');
    expect(text).toContain('Это не счёт-фактура и не УПД');
    expect(text).toContain('Комитент (принципал)');
    expect(text).not.toContain('НОМЕР СЧЁТА-ФАКТУРЫ');
  }, 120_000);
});
