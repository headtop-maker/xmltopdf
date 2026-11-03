import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { UpdMapper } from '../../src/documents/upd/upd.mapper';
import { validateUpdBusiness } from '../../src/documents/upd/upd.business';
import type { FieldLabelSource } from '../../src/mapping/coverage';
import { decodeXmlBytes } from '../../src/xml-security/encoding';
import { XmlParserService } from '../../src/xml-security/xml-parser.service';

const config = loadConfig();
const parser = new XmlParserService(config);
const labels = JSON.parse(readFileSync('resources/dictionaries/upd-title0.json', 'utf8')) as FieldLabelSource;
const fixtures = {
  schfdop: readFileSync('test/fixtures/upd-schfdop.xml', 'utf8'),
  schf: readFileSync('test/fixtures/upd-schf.xml', 'utf8'),
  dop: readFileSync('test/fixtures/upd-dop.xml', 'utf8'),
};

function parse(xml: string) {
  return parser.parse(decodeXmlBytes(Buffer.from(xml, 'utf8'), config.limits.maxDecodedBytes).text);
}

function map(xml: string) {
  const parsed = parse(xml);
  const mapper = new UpdMapper(
    labels,
    'source-hash',
    'ON_NSCHFDOPPR_1_997_01_05_03_05',
    '5.03',
    'utd970_05_03_01',
    'upd-title0-v1',
  );
  return { ...mapper.map(parsed), parsed };
}

describe('UPD mapper and coverage', () => {
  it('maps a СЧФДОП invoice and shipment with no appendix', () => {
    const { model, coverage } = map(fixtures.schfdop);
    expect(coverage.unmapped).toBe(0);
    expect(coverage.appendix).toBe(0);
    expect(coverage.rendered).toBeGreaterThan(40);
    expect(model.meta.function).toBe('СЧФДОП');
    expect(model.meta.number).toBe('СИНТ-01-01');
    expect(model.meta.currency).toMatchObject({ code: '643', name: 'Российский рубль' });
    expect(model.parties.sellers).toHaveLength(1);
    expect(model.parties.sellers[0].registration).toContain('Свидетельство');
    expect(model.parties.shipperSameAsSeller).toBe(true);
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0]).toMatchObject({
      name: 'Товар синтетический 2',
      quantity: '16',
      price: '486.89',
      amountWithoutVat: '7790.24',
      vatRate: '22%',
      vatAmount: '1713.85',
      amountWithVat: '9504.09',
      exciseNone: true,
    });
    expect(model.rows[1]).toMatchObject({ name: 'Услуга синтетическая', vatRate: '10%', vatAmount: '300.00' });
    expect(model.totals).toMatchObject({
      withoutVat: '10790.24',
      vat: '2013.85',
      withVat: '12804.09',
      netQuantity: '19',
    });
    expect(model.transfer?.operationContent).toBe('Товары переданы.');
    expect(model.transfer?.bases[0]).toMatchObject({ number: 'СИНТ-01-01' });
    expect(model.signers[0]).toMatchObject({ fio: 'Иванов Иван Иванович', signatureType: '1' });
  });

  it('does not turn a pure invoice into a shipment document', () => {
    const { model, coverage } = map(fixtures.schf);
    expect(model.meta.function).toBe('СЧФ');
    expect(model.transfer).toBeUndefined();
    expect(coverage.unmapped).toBe(0);
  });

  it('keeps transfer data out of the invoice print and reports it in the appendix', () => {
    const withTransfer = fixtures.schfdop.replace('Функция="СЧФДОП"', 'Функция="СЧФ"');
    const { model, coverage, warnings } = map(withTransfer);
    expect(model.transfer).toBeUndefined();
    expect(warnings.some((w) => w.code === 'TRANSFER_DATA_IN_INVOICE')).toBe(true);
    const appendixText = model.appendix.flatMap((group) => group.rows).map((row) => row.value);
    expect(appendixText).toContain('Товары переданы.');
    expect(coverage.unmapped).toBe(0);
  });

  it('maps a ДОП as a shipment document without inventing an invoice', () => {
    const { model } = map(fixtures.dop);
    expect(model.meta.function).toBe('ДОП');
    expect(model.rows).toHaveLength(1);
    expect(model.transfer?.withoutBasisDocument).toBe(true);
    expect(model.transfer?.bases).toHaveLength(0);
  });

  it('flags arithmetic mismatches without rewriting values', () => {
    const broken = fixtures.schfdop.replace('СтТовБезНДС="7790.24"', 'СтТовБезНДС="7800.00"');
    const report = validateUpdBusiness(parse(broken));
    expect(report.status).toBe('passed-with-warnings');
    expect(report.issues.some((issue) => issue.code === 'ARITHMETIC_AMOUNT_MISMATCH')).toBe(true);
    expect(report.issues.find((issue) => issue.code === 'ARITHMETIC_AMOUNT_MISMATCH')?.message).toContain(
      'unchanged',
    );
  });

  it('flags missing transfer data for СЧФДОП but still maps the document', () => {
    const noTransfer = fixtures.schfdop.replace(/<СвПродПер>[\s\S]*?<\/СвПродПер>/, '');
    const report = validateUpdBusiness(parse(noTransfer));
    expect(report.status).toBe('passed-with-warnings');
    expect(report.issues.some((issue) => issue.code === 'TRANSFER_SECTION_MISSING')).toBe(true);
  });
});
