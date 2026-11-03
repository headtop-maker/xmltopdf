import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binaryParser, createTestApp } from '../helpers/test-app';

const torg2Title1 = readFileSync('test/fixtures/torg2-title1.xml');
const updTitle1 = readFileSync('test/fixtures/upd-title1.xml');

function pdfText(pdf: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'xmltopdf-t1-'));
  const file = path.join(dir, 'document.pdf');
  writeFileSync(file, pdf);
  const result = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`pdftotext failed: ${result.stderr}`);
  return result.stdout.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
}

describe('second titles', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp());
  }, 180_000);

  afterAll(async () => {
    await close();
  });

  async function convert(buffer: Buffer, query = '') {
    return request(app.getHttpServer())
      .post(`/api/v1/conversions${query}`)
      .set('X-API-Key', 'test-key')
      .set('Content-Type', 'application/octet-stream')
      .send(buffer);
  }

  async function download(body: { downloadUrl: string }): Promise<Buffer> {
    const response = await request(app.getHttpServer())
      .get(new URL(body.downloadUrl).pathname)
      .buffer(true)
      .parse(binaryParser);
    expect(response.status).toBe(200);
    return response.body as Buffer;
  }

  it('prints the TORG-2 additional-information title without recreating the buyer title', async () => {
    const response = await convert(torg2Title1);
    expect(response.status).toBe(201);
    expect(response.body.document).toMatchObject({
      family: 'Torg2',
      titleIndex: 1,
      operatorVersion: 'torg2_05_01_01',
      knd: '1175015',
      function: null,
      workflowFunction: 'WithAdditionalInfo',
    });
    expect(response.body.validation).toMatchObject({
      schemaRevision: 'DP_PRIRASXDOP_1_994_02_05_01_01',
      business: 'passed',
      unmappedCount: 0,
    });
    expect(response.body.pageCount).toBe(1);

    const text = pdfText(await download(response.body));
    expect(text).toContain('Дополнительные сведения');
    expect(text).toContain('DP_PRIRASXPRINMARK_SYNTHETIC_20261102_0001');
    expect(text).toContain('Элементов ЭП в XML: 1');
    expect(text).toContain('расхождения подтверждены');
    expect(text).toContain('Иванов Иван Иванович');
    expect(text).toContain('не воспроизводит строки, суммы и подписи титула покупателя');
    // No goods rows or totals of the first title are invented.
    expect(text).not.toContain('Мука пшеничная');
    expect(text).not.toContain('49 500,00');
  }, 120_000);

  it('prints the UPD buyer confirmation without recreating the seller table', async () => {
    const response = await convert(updTitle1);
    expect(response.status).toBe(201);
    expect(response.body.document).toMatchObject({
      family: 'UniversalTransferDocument',
      titleIndex: 1,
      function: 'СЧФДОП',
      knd: '1115132',
      workflowFunction: null,
    });
    expect(response.body.validation).toMatchObject({
      schemaRevision: 'ON_NSCHFDOPPOK_1_997_02_05_03_01',
      business: 'passed',
      unmappedCount: 0,
    });
    expect(response.body.pageCount).toBe(1);

    const text = pdfText(await download(response.body));
    expect(text).toContain('Информация покупателя');
    expect(text).toContain('ON_NSCHFDOPPR_SYNTHETIC_20261007_0001');
    expect(text).toContain('Товары приняты без расхождений');
    expect(text).toContain('Код итога приёмки');
    expect(text).toContain('Иванов Иван Иванович');
    expect(text).toContain('статус завершения нельзя вывести только из этого файла');
    expect(text).not.toContain('Мука пшеничная');
    expect(text).not.toContain('49 500,00');
  }, 120_000);

});
