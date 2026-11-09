import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { Torg2Mapper } from '../../src/documents/torg2/torg2.mapper';
import { validateTorg2Business } from '../../src/documents/torg2/torg2.business';
import type { FieldLabelSource } from '../../src/mapping/coverage';
import { decodeXmlBytes } from '../../src/xml-security/encoding';
import { XmlParserService } from '../../src/xml-security/xml-parser.service';

const config = loadConfig();
const parser = new XmlParserService(config);
const labels = JSON.parse(
  readFileSync('resources/dictionaries/torg2-title0.json', 'utf8'),
) as FieldLabelSource;
const sampleText = new TextDecoder('windows-1251').decode(readFileSync('test/fixtures/torg2.xml'));

function map(xml: string) {
  const decoded = decodeXmlBytes(Buffer.from(xml, 'utf8'), config.limits.maxDecodedBytes);
  const parsed = parser.parse(decoded.text);
  const mapper = new Torg2Mapper(
    labels,
    'source-hash',
    'DP_PRIRASXPRIN_1_994_01_05_01_04',
    '5.01',
    'torg2_05_01_01',
    'torg2-title0-v1',
    1000,
  );
  return { ...mapper.map(parsed), parsed };
}

function utf8Sample(): string {
  return sampleText.replace('encoding="windows-1251"', 'encoding="utf-8"');
}

describe('TORG-2 mapper and coverage', () => {
  it('maps every meaningful value of the sample and leaves no appendix', () => {
    const { model, coverage } = map(utf8Sample());
    expect(coverage.unmapped).toBe(0);
    expect(coverage.appendix).toBe(0);
    expect(coverage.rendered).toBeGreaterThan(30);
    expect(coverage.technical).toBeGreaterThan(0);

    expect(model.meta.documentNumber).toBe('УПД-ЭТрН-001');
    expect(model.meta.documentDate).toBe('02.11.2026');
    expect(model.parties.seller?.name).toBe(
      'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ТОРГОВЫЙ ДОМ ФЛАГМАН"',
    );
    expect(model.parties.buyer?.inn).toBe('6163106798');
    expect(model.parties.consignee?.address).toContain('ул Доватора');
    expect(model.inspection.accompanyingDocuments[0]).toMatchObject({
      name: 'Универсальный передаточный документ',
      number: 'УПД-ЭТрН-001',
      date: '24.09.2026',
    });
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]).toMatchObject({
      name: 'Мука пшеничная хлебопекарная',
      unitName: 'Килограмм',
      unitCode: '166',
      byDocument: { quantity: '1000', price: '45', amountWithVat: '49500.00', vatAmount: '4500.00' },
      byFact: { quantity: '950', amountWithVat: '47025.00', vatAmount: '4275.00' },
      shortage: { quantity: '50', amountWithVat: '2475.00', vatAmount: '225.00' },
      surplus: { quantity: '0' },
    });
    expect(model.totals.byDocument.amountWithVat?.replace(/\u00a0/g, ' ')).toBe('49 500,00');
    expect(model.totals.byFact.amountWithVat?.replace(/\u00a0/g, ' ')).toBe('47 025,00');
    expect(model.signers[0]).toMatchObject({
      kind: 'ЮЛ',
      fio: 'СУХОМЛИНОВ СЕРГЕЙ ПЕТРОВИЧ',
      position: 'ГЕНЕРАЛЬНЫЙ ДИРЕКТОР',
      basis: 'Должностные обязанности',
    });
    expect(model.meta.additionalInfoCodes[0]).toContain('Код 1');
  });

  it('maps direct info attributes and nested exchange participants without an appendix', () => {
    const enriched = utf8Sample()
      .replace(
        '</СвУчДокОбор>',
        '<СвОЭДОтпрСФ ИННЮЛ="6663003127" ИдЭДОСФ="2BM" НаимОрг="АО «ПФ «СКБ Контур»"/></СвУчДокОбор>',
      )
      .replace(
        '</СодФХЖ2>',
        '<ИнфПолФХЖ2 Идентиф="Описание дефектов" Значен="повреждена упаковка"/></СодФХЖ2>',
      );

    const { model, coverage } = map(enriched);
    expect(coverage.unmapped).toBe(0);
    expect(coverage.appendix).toBe(0);
    expect(model.event.info).toEqual([{ id: 'Описание дефектов', value: 'повреждена упаковка' }]);
  });

  it('sends unknown-but-populated values to the appendix rather than dropping them', () => {
    const withExtra = utf8Sample().replace(
      '</Документ>',
      '<ДополнительныйРеквизит Наименование="Тестовое поле" Значение="важно"/></Документ>',
    );
    const { model, coverage } = map(withExtra);
    expect(coverage.appendix).toBe(2);
    expect(coverage.unmapped).toBe(0);
    const rows = model.appendix.flatMap((group) => group.rows);
    expect(rows.some((row) => row.value === 'Тестовое поле')).toBe(true);
    expect(rows.some((row) => row.value === 'важно')).toBe(true);
  });

  it('does not merge goods rows and keeps explicit zero distinct from absent data', () => {
    const twoRows = utf8Sample().replace(
      '</СодФХЖ2>',
      `<РезПрием ОКЕИ_Тов="166" НаимЕдИзм="Килограмм"><Ценности НаимТов="Второй товар"/>` +
        `<ПоДокум КолТовПрин="10" ЦенаПрин="100" СтавНДСПрин="20%" СтоимТовНДСПрин="1200.00" СумНДСПрин="200.00"/>` +
        `</РезПрием></СодФХЖ2>`,
    );
    const { model } = map(twoRows);
    expect(model.rows).toHaveLength(2);
    expect(model.rows[1].name).toBe('Второй товар');
    expect(model.rows[1].surplus).toBeUndefined();
  });

  it('accepts a VAT-inclusive price when the amount matches quantity × price', () => {
    const bytes = readFileSync('test/fixtures/torg2-vat-included.xml');
    const decoded = decodeXmlBytes(bytes, config.limits.maxDecodedBytes);
    const report = validateTorg2Business(parser.parse(decoded.text));
    expect(report.issues.filter((issue) => issue.code === 'ARITHMETIC_AMOUNT_MISMATCH')).toHaveLength(0);
    expect(report.status).toBe('passed');
  });

  it('reports arithmetic mismatches as warnings without changing values', () => {
    const broken = utf8Sample().replace('СтоимТовНДСПрин="49500.00"', 'СтоимТовНДСПрин="50000.00"');
    const decoded = decodeXmlBytes(Buffer.from(broken, 'utf8'), config.limits.maxDecodedBytes);
    const report = validateTorg2Business(parser.parse(decoded.text));
    expect(report.status).toBe('passed-with-warnings');
    expect(report.issues.some((issue) => issue.code === 'ARITHMETIC_AMOUNT_MISMATCH')).toBe(true);
    expect(report.issues[0].message).toContain('printed unchanged');
  });
});
