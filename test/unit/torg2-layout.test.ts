import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { Torg2Mapper } from '../../src/documents/torg2/torg2.mapper';
import { renderTorg2Html } from '../../src/documents/torg2/torg2.template';
import { formatMoney, formatQuantity } from '../../src/documents/shared/format';
import type { FieldLabelSource } from '../../src/mapping/coverage';
import { decodeXmlBytes } from '../../src/xml-security/encoding';
import { XmlParserService } from '../../src/xml-security/xml-parser.service';

const config = loadConfig();
const parser = new XmlParserService(config);
const labels = JSON.parse(readFileSync('resources/dictionaries/torg2-title0.json', 'utf8')) as FieldLabelSource;
const sample = new TextDecoder('windows-1251').decode(readFileSync('test/fixtures/torg2.xml'));

function render(xml: string): string {
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
  const result = mapper.map(parsed);
  return renderTorg2Html(result.model, { fontCss: '' });
}

const xml = sample.replace('encoding="windows-1251"', 'encoding="utf-8"');

describe('TORG-2 layout contract', () => {
  it('has 18 discrepancy columns and no empty header strip', () => {
    const html = render(xml);
    expect(html).not.toContain('<th colspan="10"></th>');
    expect(html).toContain('<th rowspan="4">№<br>п/п</th>');
    const discrepancyTable = html.slice(html.indexOf('class="grid discrepancies'));
    const numbersRow = /<tr class="numbers">([\s\S]*?)<\/tr>/.exec(discrepancyTable)?.[1] ?? '';
    expect((numbersRow.match(/<td>/g) ?? []).length).toBe(18);
    expect(html).toContain('font-size: 8pt');
  });

  it('does not invent a conclusion, opening date or representative authority', () => {
    const html = render(xml);
    expect(html).not.toContain('Заключение комиссии');
    expect(html).toMatch(/Дата вскрытия тары[\s\S]{0,120}?<span class="line-value"><\/span>/);
    expect(html).toMatch(/Документ, удостоверяющий полномочия[\s\S]{0,160}?<span class="line-value"><\/span>/);
    // The signer's authority basis is shown only in the signer block, never in the representative line.
    expect(html).toContain('Основание полномочий подписанта: Должностные обязанности.');
  });

  it('renders conclusion, opening date and operation type when they are present in XML', () => {
    const withFields = xml
      .replace('СодСоб="Расхождения при приемке товаров по УПД № УПД-ЭТрН-001 от 24.09.2026"', 'СодСоб="Расхождения при приемке товаров по УПД № УПД-ЭТрН-001 от 24.09.2026" Заключение="Комиссия подтверждает расхождения" ВидОперации="Приемка"')
      .replace('<ИнфДопСв>1</ИнфДопСв>', '<ИнфДопСв>1</ИнфДопСв><СвВремПрием ВскрытГруз="04.11.2026 10.30.00" />');
    const html = render(withFields).replace(/<[^>]+>/g, ' ');
    expect(html).toContain('Заключение комиссии');
    expect(html).toContain('Комиссия подтверждает расхождения');
    expect(html).toContain('04.11.2026');
    expect(html).toContain('Вид операции:');
    expect(html).toContain('Приемка');
  });

  it('preserves decimal precision and distinguishes zero from absence', () => {
    expect(formatQuantity('2.50000000001')).toBe('2,50000000001');
    expect(formatQuantity('0')).toBe('0');
    expect(formatMoney('980.1')).toBe('980,10');
    expect(formatMoney(undefined)).toBeUndefined();
  });

  it('moves overlong characteristics to an appendix instead of a split table row', () => {
    const longCharacteristic = 'Х'.repeat(500);
    const withLong = xml.replace('НаимТов="Мука пшеничная хлебопекарная"', `ХарактТов="${longCharacteristic}" НаимТов="Мука пшеничная хлебопекарная"`);
    const html = render(withLong);
    expect(html).toContain('Характеристики товарных строк');
    expect(html).toContain(longCharacteristic);
    expect(html).toContain('см. приложение');
  });
});
