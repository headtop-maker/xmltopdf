import { describe, expect, it } from 'vitest';
import type { UpdPrintModel } from '../../src/documents/upd/upd.model';
import { renderUpdSabyHtml } from '../../src/documents/upd/upd-saby.template';

const model = {
  meta: {
    family: 'UniversalTransferDocument',
    function: 'СЧФДОП',
    functionLabel: 'СЧФДОП',
    formatVersion: '5.03',
    operatorVersion: 'utd970_05_03_01',
    schemaRevision: 'ON_NSCHFDOPPR_1_997_01_05_03_05',
    knd: '1115131',
    number: '262',
    date: '31.10.2026',
    organization: 'ИП Седых Н.В., ИНН 616500296568',
    sourceSha256: 'hash',
    templateVersion: 'upd-saby-draft',
    currency: { name: 'Российский рубль', code: '643' },
  },
  parties: {
    sellers: [{
      kind: 'ИП',
      name: 'Седых Николай Васильевич',
      shortName: 'ИП Седых Н.В.',
      inn: '616500296568',
      ogrn: '304616512100182',
      registrationDate: '30.04.2004',
      address: '141420, Московская область, городской округ Химки, г. Химки, мкр. Сходня, туп. 2-й Мичуринский, д. 1, кв. 284',
      bank: 'р/с 40802810926080000379, ФИЛИАЛ "РОСТОВСКИЙ" АО "АЛЬФА-БАНК", БИК 046015207, к/с 30101810500000000207',
    }],
    buyers: [{
      kind: 'ИП',
      name: 'Тришечкина Людмила Николаевна',
      inn: '616401491751',
      address: '344113, Ростовская область, г. Ростов-на-Дону, пр-кт Королева, д. 15/3, кв. 92',
    }],
    shippers: [],
    consignees: [],
    shipperSameAsSeller: false,
  },
  invoice: {
    paymentDocuments: [{ number: '660', date: '28.09.2026' }],
    shipmentDocuments: [{ kind: 'Универсальный передаточный документ', number: '262', date: '31.10.2026' }],
    specialCircumstances: [],
    obligationTypes: [],
    info: [],
  },
  rows: [{
    number: '1',
    name: 'Постоянная часть Арендной платы по договору за октябрь 2026 г.',
    vatRate: '5%',
    amountWithoutVat: '80000.00',
    vatAmount: '4000.00',
    amountWithVat: '84000.00',
    vatNone: false,
    countryNames: [],
    customsNumbers: [],
    marking: { kiz: [], packaging: [] },
    traceability: [],
    accessoryDocuments: [],
    info: [],
    extra: { code: 'БП-00000123' },
  }],
  totals: { withoutVat: '80000.00', vat: '4000.00', withVat: '84000.00' },
  transfer: {
    date: '31.10.2026',
    bases: [{ kind: 'б/н от 21.01.2025 Вятская 118 (2026)', number: 'б/н', date: '01.01.2026' }],
    person: { role: 'передал', fio: 'Седых Николай Васильевич' },
    info: [],
  },
  signers: [{ fio: 'Седых Николай Васильевич', position: 'Индивидуальный предприниматель', powersOfAttorney: [] }],
  appendix: [],
  coverage: { unmapped: 0, appendix: 0, rendered: 0, technical: 0 },
} as unknown as UpdPrintModel;

describe('UPD Saby-style layout', () => {
  const html = renderUpdSabyHtml(model, { fontCss: '' });
  const text = html.replace(/\u00a0/g, ' ');

  it('prints the invoice header and one page container', () => {
    expect(html).toContain('Счет-фактура № 262 от 31 октября 2026 г.');
    expect(html).toContain('width: 841.92pt; height: 594.96pt');
    expect(html).not.toContain('Страница');
  });

  it('uses the 16 reference columns with the given widths', () => {
    expect((html.match(/<col style="width:/g) ?? []).length).toBe(16);
    for (const width of ['65.27pt', '16.51pt', '139.54pt', '80.28pt']) {
      expect(html).toContain(`width:${width}`);
    }
  });

  it('prints money with space grouping and dot decimals', () => {
    expect(text).toContain('80 000.00');
    expect(text).toContain('4 000.00');
    expect(text).toContain('84 000.00');
    expect(html).toContain('Всего к оплате');
  });

  it('never prints acceptance, stamps or the word "электронно"', () => {
    expect(html).not.toContain('электронно');
    expect(html).not.toContain('ДОКУМЕНТ ПОДПИСАН');
  });

  it('shifts the bottom block by 18 pt per additional item row', () => {
    const second = { ...model.rows[0], number: '2', extra: { code: 'БП-00000124' } };
    const twoRows = { ...model, rows: [model.rows[0], second] } as unknown as UpdPrintModel;
    const twoHtml = renderUpdSabyHtml(twoRows, { fontCss: '' });
    expect(twoHtml).toContain('top:18pt');
    expect(twoHtml).toContain('БП-00000124');
  });

  it('prints the seller short name and bank details', () => {
    expect(html).toContain('ИП Седых Н.В.');
    expect(html).toContain('в ФИЛИАЛ');
  });
});
