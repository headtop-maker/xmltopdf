import { escapeHtml, formatRate } from '../shared/format';
import type { PartyModel } from '../shared/party';
import type { UpdPrintModel, UpdRow, UpdSigner, UpdTransfer } from './upd.model';

export interface UpdSabyOptions {
  readonly fontCss: string;
  /**
   * Test-only demo mode (DEMO_FILL_BLANKS=true): fills the paper blanks the
   * official XML format does not carry (receipt date, receiver, note column).
   * Never enabled in production: the printed document must mirror the XML.
   */
  readonly demoBlanks?: boolean;
  readonly pageCount?: number;
}

const DEMO_RECEIPT = {
  position: 'КЛАДОВЩИК',
  fio: 'СИДОРОВА МАРИЯ ПЕТРОВНА',
  date: '24.09.2026',
  note: 'Товар принят без претензий по количеству и качеству',
};

const e = (value: string | undefined | null): string => escapeHtml(value ?? '');
const dash = (value: string | undefined): string => (value?.trim() ? e(value.trim()) : '-');

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function dateRu(value: string | undefined): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value?.trim() ?? '');
  if (!match) return dash(value);
  return `${match[1]} ${MONTHS[Number(match[2]) - 1] ?? ''} ${match[3]} г.`;
}

function dateShort(value: string | undefined): string {
  return value?.trim() ? e(value.trim()) : '---';
}

/** 80000.00 -> 80 000.00; sums in this form use space grouping and dot decimals. */
function moneyText(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return '-';
  const normalized = raw.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return raw;
  const negative = normalized.startsWith('-');
  const [integer, fraction = ''] = normalized.replace('-', '').split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const decimals = (fraction + '00').slice(0, 2);
  return `${negative ? '-' : ''}${grouped}.${decimals}`;
}

function money(value: string | undefined): string {
  return e(moneyText(value).replace(/ /g, '\u00a0'));
}

function plain(value: string | undefined): string {
  return value?.trim() ? value.trim() : '-';
}

function shortFio(full: string | undefined): string {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  const initials = parts.slice(1).map((part) => `${part[0]}.`).join('');
  return `${parts[0]} ${initials}`;
}

function partyShort(party: PartyModel | undefined): string {
  if (!party) return '-';
  if (party.shortName?.trim()) return e(party.shortName.trim());
  if (party.kind === 'ИП' || party.kind === 'ФЛ') return e(`ИП ${shortFio(party.name)}`.trim());
  return e(party.name);
}

function partyInn(party: PartyModel | undefined): string {
  if (!party) return '-';
  if (party.kind === 'ЮЛ') {
    return [party.inn, party.kpp].filter(Boolean).join('/') || '-';
  }
  return party.inn || '-';
}

function partyBank(party: PartyModel | undefined): string {
  const bank = party?.bank?.trim();
  // The blank keeps this line empty when the source carries no bank details;
  // a dash at the page edge reads as a stray mark.
  if (!bank) return '';
  // "р/с 4080..., БАНК, БИК ..., к/с ..." -> "р/с 4080... в БАНК, БИК ..., к/с ..."
  return e(bank.replace(/^(р\/с\s+\d+),\s*/, '$1 в '));
}

function ogrnText(party: PartyModel | undefined): string {
  if (!party) return '';
  return [party.ogrn, party.registrationDate].filter(Boolean).join(', ');
}

function basisText(transfer: UpdTransfer | undefined): string {
  const base = transfer?.bases?.[0];
  if (!base) return '-';
  const name = (base.kind ?? base.name)?.trim() ?? '';
  const number = base.number?.trim() ?? '';
  const date = base.date?.trim() ?? '';
  if (!name && !number) return '-';
  // Normalized mode: if the name already carries both number and date, do not repeat them.
  if (number && date && name.includes(number) && name.includes(date)) {
    return e(`№ ${number} от ${date}`);
  }
  const head = name || `№ ${number}`;
  const withNumber = number && !head.includes(number) ? `${head} № ${number}` : head;
  return e([withNumber, date ? `от ${date}` : ''].filter(Boolean).join(' '));
}

function infoText(items: readonly { id: string; value: string }[]): string {
  return items
    .map((item) => [item.id, item.value].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('; ');
}

function signerOfType(signers: readonly UpdSigner[], type: string): UpdSigner | undefined {
  return signers.find((signer) => signer.signatureType === type);
}

function dateParts(value: string | undefined): [string, string, string] {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value?.trim() ?? '');
  return match ? [match[1], MONTHS[Number(match[2]) - 1] ?? '', match[3].slice(2)] : ['', '', ''];
}

function itemCells(row: UpdRow): string {
  return `<td class="c">${dash(row.extra?.code ?? row.extra?.catalogCode)}</td>
<td class="c">${dash(row.number)}</td>
<td class="name">${dash(row.name)}</td>
<td class="c">${dash(row.extra?.productTypeCode)}</td>
<td class="c">${dash(row.unitCode)}</td>
<td class="c">${dash(row.unitName)}</td>
<td class="c">${dash(row.quantity)}</td>
<td class="c">${dash(row.price)}</td>
<td class="n">${money(row.amountWithoutVat)}</td>
<td class="c">${row.exciseNone ? 'без акциза' : dash(row.exciseAmount)}</td>
<td class="c">${row.vatNone ? 'без НДС' : dash(formatRate(row.vatRate))}</td>
<td class="n">${row.vatNone ? 'без НДС' : money(row.vatAmount)}</td>
<td class="n">${money(row.amountWithVat)}</td>
<td class="c">${dash(row.countryCode)}</td>
<td class="c">${dash(row.countryNames[0])}</td>
<td class="c wrap">${dash(row.customsNumbers[0])}</td>`;
}

const TABLE_COLUMNS = [65.2, 16.5, 135.0, 47.2, 17.3, 44.2, 42.9, 40.6, 56.9, 40.7, 32.0, 55.5, 57.2, 40.3, 40.7, 81.0];
const TABLE_WIDTH = 813.2;
/** Columns whose content is a number or an identifier; they must not collide. */
const CONTENT_SIZED_COLUMNS = [3, 6, 7, 8, 9, 11, 12, 14];
const NAME_COLUMN = 2;
const NAME_COLUMN_MIN = 95;

/** Rough Tahoma advance widths at 7 pt, enough to reserve a non-colliding cell. */
function approximateWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    if (character === ' ') width += 1.95;
    else if (character >= '0' && character <= '9') width += 3.85;
    else if (character === '.' || character === ',' || character === '/') width += 2.1;
    else if (/[A-ZА-ЯЁ]/.test(character)) width += 4.55;
    else width += 3.6;
  }
  return width;
}

function rowTexts(row: UpdRow): string[] {
  return [
    plain(row.extra?.code ?? row.extra?.catalogCode),
    plain(row.number),
    plain(row.name),
    plain(row.extra?.productTypeCode),
    plain(row.unitCode),
    plain(row.unitName),
    plain(row.quantity),
    plain(row.price),
    moneyText(row.amountWithoutVat),
    row.exciseNone ? 'без акциза' : plain(row.exciseAmount),
    row.vatNone ? 'без НДС' : plain(formatRate(row.vatRate)),
    moneyText(row.vatAmount),
    moneyText(row.amountWithVat),
    plain(row.countryCode),
    plain(row.countryNames[0]),
    plain(row.customsNumbers[0]),
  ];
}

/**
 * Reference column widths, widened only where the content needs it. The extra
 * width is taken from the goods-name column, so the blank keeps its geometry
 * for ordinary documents and stays readable for large amounts.
 */
function columnWidths(rows: readonly UpdRow[]): number[] {
  const texts = rows.map(rowTexts);
  const widths = [...TABLE_COLUMNS];
  const growth = new Map<number, number>();
  for (const index of CONTENT_SIZED_COLUMNS) {
    const required = Math.max(...texts.map((cells) => approximateWidth(cells[index] ?? ''))) + 3.4;
    const extra = Math.max(0, required - TABLE_COLUMNS[index]);
    if (extra > 0) growth.set(index, extra);
  }
  const requested = [...growth.values()].reduce((sum, value) => sum + value, 0);
  const available = TABLE_COLUMNS[NAME_COLUMN] - NAME_COLUMN_MIN;
  const scale = requested > available && requested > 0 ? available / requested : 1;
  let taken = 0;
  for (const [index, extra] of growth) {
    const granted = extra * scale;
    widths[index] = TABLE_COLUMNS[index] + granted;
    taken += granted;
  }
  widths[NAME_COLUMN] = TABLE_COLUMNS[NAME_COLUMN] - taken;
  const total = widths.reduce((sum, value) => sum + value, 0);
  widths[NAME_COLUMN] += TABLE_WIDTH - total;
  return widths;
}

export function renderUpdSabyHtml(model: UpdPrintModel, options: UpdSabyOptions): string {
  const { meta, parties, invoice, rows, totals, transfer, signers } = model;
  const seller = parties.sellers[0];
  const buyer = parties.buyers[0];
  const shipper = parties.shippers[0];
  const shipperSame = parties.shipperSameAsSeller === true;
  const consignee = parties.consignees[0];
  const signer = signers[0];
  const widths = columnWidths(rows);
  // The advance-invoice row (5б) exists only in the invoice+shipment variant; a shipment-only
  // document (ДОП) omits it, exactly as the reference blank does.
  const showAdvanceInvoice = meta.function === 'СЧФДОП';
  const rowShift = showAdvanceInvoice ? 0 : -18.2;
  const row6 = 132.1 + rowShift;
  const row6a = 141.8 + rowShift;
  const row6b = 151.6 + rowShift;
  const row7 = 162.1 + rowShift;
  const row8 = 172.6 + rowShift;
  const demo = options.demoBlanks === true;
  const [receiptDay, receiptMonth, receiptYear] = dateParts(DEMO_RECEIPT.date);
  // The status is not an XML attribute: ФНС derives it from Документ/@Функция.
  // Saby prints 1 for СЧФДОП and 2 for ДОП on the same blank.
  const status = meta.function === 'СЧФДОП' ? '1' : meta.function === 'ДОП' ? '2' : '';

  const [transferDay, transferMonth, transferYear] = dateParts(transfer?.date);
  const sellerIsIp = seller?.kind === 'ИП';
  // A sole trader signs the organisation's lines personally: the name goes to the ИП row only.
  const directorSigner = sellerIsIp ? undefined : signerOfType(signers, '1');
  const accountantSigner = sellerIsIp ? undefined : signerOfType(signers, '2');
  const transferor = transfer?.person
    ?? (sellerIsIp ? { position: 'ИП', fio: signerOfType(signers, '1')?.fio ?? seller?.name } : undefined);
  const payment = invoice.paymentDocuments[0];
  const shipment = invoice.shipmentDocuments[0];
  const nameColumnWidth = Math.max(60, widths[2] - 3);
  const LINE_HEIGHT = 8.05;
  // A row taller than the printable area is split into parts by the template:
  // the browser cannot re-flow a table row across pages, it only clips it.
  const PART_HEIGHT = 280;
  // Reserve one line for the continuation mark on every part.
  const linesPerPart = Math.max(4, Math.floor((PART_HEIGHT - 2) / LINE_HEIGHT) - 2);

  const wrapLines = (text: string): string[] => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || approximateWidth(candidate) <= nameColumnWidth) current = candidate;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  const rowHeight = (row: UpdRow): number => wrapLines(plain(row.name)).length * LINE_HEIGHT + 3;

  const rowParts = (row: UpdRow): string[] => {
    if (rowHeight(row) <= PART_HEIGHT + 20) return [`<tr>${itemCells(row)}</tr>`];
    const lines = wrapLines(plain(row.name));
    const parts: string[][] = [];
    for (let i = 0; i < lines.length; i += linesPerPart) parts.push(lines.slice(i, i + linesPerPart));
    const key = row.number || '';
    return parts.map((part, index) => {
      const name = index === 0
        ? e(part.join(' '))
        : `<div class="cont-mark">Продолжение позиции ${e(key)}</div>${e(part.join(' '))}`;
      if (index === 0) {
        const cells = itemCells(row).replace(/<td class="name">[\s\S]*?<\/td>/, `<td class="name">${name}</td>`);
        return `<tr class="part">${cells}</tr>`;
      }
      const empty = Array.from({ length: 16 }, (_, cell) => (cell === 2 ? `<td class="name">${name}</td>` : '<td></td>')).join('');
      return `<tr class="part">${empty}</tr>`;
    });
  };

  const itemRows = rows.length
    ? rows.map((row) => rowParts(row).join('')).join('')
    : `<tr>${Array.from({ length: 16 }, (_, index) => `<td class="${index === 2 ? 'name' : 'c'}">-</td>`).join('')}</tr>`;

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>УПД ${e(meta.number)}</title>
<style>
${options.fontCss}
@page { size: A4 landscape; margin: 0 0 30pt 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Tahoma', 'Liberation Sans', Arial, sans-serif; font-size: 7pt; line-height: 1.15; color: #000; }
.page { position: relative; width: 841.92pt; min-height: 564.96pt; }
.abs { position: absolute; }
.band { position: absolute; left: 14pt; top: 17.5pt; width: 64pt; font-size: 6.5pt; line-height: 8.5pt; border-right: 0.75pt solid #000; }
.band .upd-title { margin-bottom: 4pt; }
.status-row { margin-top: 6.7pt; display: flex; align-items: center; font-size: 6.5pt; }
.status-box { display: inline-block; border: 0.7pt solid #000; padding: 0 6pt; margin-left: 10pt; font-size: 6.5pt; line-height: 8pt; }
.status-text { margin-top: 7pt; font-size: 6.3pt; line-height: 9pt; }

.title { left: 85.3pt; top: 19.75pt; font-size: 9pt; font-weight: bold; }
.correction { left: 85.3pt; top: 31.45pt; font-size: 7pt; }
.row-label { left: 84.5pt; font-size: 7pt; }
.row-label.wrap { font-size: 4.2pt; line-height: 4.8pt; }
.row-value { left: 230.8pt; font-size: 7pt; }
.hv { left: 229.4pt; width: 589pt; height: 7.5pt; border-bottom: 0.6pt solid #000; display: flex; align-items: flex-end; padding-bottom: 0.4pt; }
.bold { font-weight: bold; }
.row-marker { left: 807pt; font-size: 6pt; text-align: right; width: 10pt; }
.small-caption { font-size: 6pt; color: #000; }
.underline { border-bottom: 0.6pt solid #000; }
table.items { position: relative; margin: 0 0 0 14pt; width: 813.2pt; table-layout: fixed; border-collapse: collapse; }
table.items th, table.items td { border: 0.75pt solid #000; padding: 1pt 1.5pt; vertical-align: middle; }
table.items th { font-weight: normal; font-size: 7pt; line-height: 7.4pt; text-align: center; vertical-align: top; padding-top: 2pt; hyphens: auto; overflow-wrap: break-word; }
table.items tr { break-inside: avoid; }
table.items tr.part { break-inside: avoid; }
.cont-mark { font-style: italic; color: #333; display: block; margin-bottom: 0.5pt; }
table.items tr.h1 th { height: 23.26pt; }
table.items tr.h2 th { height: 46.51pt; }
table.items td { font-size: 7pt; padding: 0.6pt 1.5pt; }
table.items td.c { text-align: center; }
table.items td.n { text-align: right; white-space: nowrap; }
table.items td.wrap { white-space: normal; word-break: break-all; }
table.items td.name { text-align: left; overflow-wrap: break-word; }
table.items tr.letters td { font-size: 6.5pt; text-align: center; height: 11.33pt; }
table.items tr.page-top td { height: 12pt; border: none; padding: 0; }
table.items tr.totals td { height: 11.26pt; font-size: 7pt; padding: 0.6pt 1.5pt; }
table.items tr.totals { break-before: avoid; }
table.items tr.totals td.label { text-align: left; font-size: 8pt; font-weight: bold; padding-left: 3.5pt; }
table.items tr.totals td { font-weight: normal; }
.letters-label { font-weight: normal; }
.signature-block { position: relative; width: 841.92pt; height: 262pt; margin-top: 0; break-inside: avoid; }
.bottom { position: absolute; left: 14pt; width: 805.5pt; }
.line-row { display: flex; align-items: flex-end; gap: 4pt; }
.line-row .grow { flex: 1; border-bottom: 0.6pt solid #000; height: 8.5pt; }
.caption-center { text-align: center; font-size: 6pt; }
.two-col { display: flex; gap: 8pt; }
.two-col > div { flex: 1; }
.signature-line { border-bottom: 0.6pt solid #000; height: 8.5pt; }
.info-value { white-space: normal; word-break: break-word; line-height: 7.2pt; }
</style></head>
<body><div class="page">
  <div class="band">
    <div class="upd-title">Универсальный<br>передаточный<br>документ</div>
    <div class="status-row"><strong>Статус:</strong><span class="status-box">${status}</span></div>
    <div class="status-text"><strong>1</strong> – счет-фактура<br>и передаточный<br>документ (акт)<br><strong>2</strong> – передаточный<br>документ (акт)</div>
  </div>

  <div class="abs" style="left:400pt;top:17.5pt;width:417pt;text-align:right;font-size:6pt;line-height:7.4pt">Приложение N 1 к постановлению Правительства Российской Федерации от 26.12.2011 №1137<br>(в ред. Постановления Правительства РФ от 23.01.2026 № 26)</div>
  <div class="abs title">Счет-фактура № ${e(meta.number)} от ${dateRu(meta.date)}</div>
  <div class="abs correction">Исправление № ${dateShort(meta.correctionNumber)} от ${dateShort(meta.correctionDate)}</div>

  <div class="abs row-label bold" style="top:41.3pt">Продавец</div>
  <div class="abs row-value hv bold" style="top:41.3pt">${partyShort(seller)}</div>
  <div class="abs row-marker" style="top:41.3pt">(2)</div>

  <div class="abs row-label" style="top:50.3pt">Адрес</div>
  <div class="abs row-value hv" style="top:50.3pt">${dash(seller?.address)}</div>
  <div class="abs row-marker" style="top:50.3pt">(2а)</div>

  <div class="abs row-label" style="top:60.1pt">ИНН/КПП продавца</div>
  <div class="abs row-value hv" style="top:60.1pt">${partyInn(seller)}</div>
  <div class="abs row-marker" style="top:60.1pt">(2б)</div>

  <div class="abs row-label" style="top:71.3pt">Грузоотправитель и его адрес:</div>
  <div class="abs row-value hv" style="top:71.3pt">${shipper ? `${e(shipper.name)}, ${e(shipper.address ?? '')}` : shipperSame ? 'он же' : '-'}</div>
  <div class="abs row-marker" style="top:71.3pt">(3)</div>

  <div class="abs row-label" style="top:81.8pt">Грузополучатель и его адрес:</div>
  <div class="abs row-value hv bold" style="top:81.8pt">${consignee ? `${partyShort(consignee)}, ${e(consignee.address ?? '')}` : '-'}</div>
  <div class="abs row-marker" style="top:81.8pt">(4)</div>

  <div class="abs row-label" style="top:92.3pt">К платежно-расчетному документу</div>
  <div class="abs row-value hv" style="top:92.3pt">${payment ? `№ ${dash(payment.number)} от ${dash(payment.date)}` : '-'}</div>
  <div class="abs row-marker" style="top:92.3pt">(5)</div>

  <div class="abs row-label" style="top:102.8pt">Документ об отгрузке:</div>
  <div class="abs row-value hv" style="top:102.8pt">${shipment ? `${e(shipment.kind ?? shipment.name ?? '')}, № ${e(shipment.number ?? '')} от ${e(shipment.date ?? '')}` : '-'}</div>
  <div class="abs row-marker" style="top:102.8pt">(5а)</div>

  ${showAdvanceInvoice ? `<div class="abs row-label" style="top:112pt;width:500pt;font-size:6pt;line-height:8.3pt">К счету-фактуре (счетам-фактурам), выставленному (выставленным) при получении оплаты, частичной оплаты или иных платежей в счет предстоящих поставок товаров (выполнения работ, оказания услуг), передачи имущественных прав</div>
  <div class="abs" style="top:120.3pt;left:585.7pt;width:20pt;font-size:7pt">-</div>
  <div class="abs row-marker" style="top:112pt">(5б)</div>` : ''}

  <div class="abs row-label bold" style="top:${row6}pt">Покупатель</div>
  <div class="abs row-value hv bold" style="top:${row6}pt">${partyShort(buyer)}</div>
  <div class="abs row-marker" style="top:${row6}pt">(6)</div>

  <div class="abs row-label" style="top:${row6a}pt">Адрес</div>
  <div class="abs row-value hv" style="top:${row6a}pt">${dash(buyer?.address)}</div>
  <div class="abs row-marker" style="top:${row6a}pt">(6а)</div>

  <div class="abs row-label" style="top:${row6b}pt">ИНН/КПП покупателя</div>
  <div class="abs row-value hv" style="top:${row6b}pt">${partyInn(buyer)}</div>
  <div class="abs row-marker" style="top:${row6b}pt">(6б)</div>

  <div class="abs row-label" style="top:${row7}pt">Валюта: наименование, код</div>
  <div class="abs row-value hv" style="top:${row7}pt">${e(meta.currency.name ?? '')}${meta.currency.code ? `, код - ${e(meta.currency.code)}` : ''}</div>
  <div class="abs row-marker" style="top:${row7}pt">(7)</div>

  <div class="abs row-label" style="top:${row8}pt;width:258pt;font-size:6.2pt;white-space:nowrap">Идентификатор государственного контракта, договора (соглашения) (при наличии)</div>
  <div class="abs row-value hv" style="top:${row8}pt;left:340pt;width:480pt">${invoice.gosContractId?.trim() ? e(invoice.gosContractId) : ''}</div>
  <div class="abs row-marker" style="top:${row8}pt">(8)</div>

  <div style="height:${(showAdvanceInvoice ? 178.85 : 160.65)}pt"></div>
  <table class="items">
    <colgroup>${widths.map((width) => `<col style="width:${width.toFixed(2)}pt">`).join('')}</colgroup>
    <thead>
      <tr class="page-top"><td colspan="16"></td></tr>
      <tr class="h1">
        <th rowspan="2">Код<br>товара/<br>работ,<br>услуг</th>
        <th rowspan="2">№<br>п/п</th>
        <th rowspan="2">Наименование товара<br>(описание выполненных работ,<br>оказанных услуг),<br>имущественного права</th>
        <th rowspan="2">Код<br>вида<br>товара</th>
        <th colspan="2">Единица измерения</th>
        <th rowspan="2">Количество<br>(объем)</th>
        <th rowspan="2">Цена<br>(тариф)<br>за<br>единицу<br>измерения</th>
        <th rowspan="2">Стоимость<br>товаров<br>(работ, услуг),<br>имущественных<br>прав без<br>налога - всего</th>
        <th rowspan="2">В том<br>числе<br>сумма<br>акциза</th>
        <th rowspan="2">Налого-<br>вая<br>ставка</th>
        <th rowspan="2">Сумма налога,<br>предъявляемая<br>покупателю</th>
        <th rowspan="2">Стоимость<br>товаров<br>(работ, услуг),<br>имущественных<br>прав с<br>налогом - всего</th>
        <th colspan="2">Страна происхож-<br>дения товара</th>
        <th rowspan="2" style="hyphens:none">Регистрационный<br>номер декларации на<br>товары или<br>регистрационный<br>номер партии товара,<br>подлежащего<br>прослеживаемости</th>
      </tr>
      <tr class="h2">
        <th>код</th>
        <th style="hyphens:none">условное<br>обозначе-<br>ние (нацио-<br>нальное)</th>
        <th>Цифровой<br>код</th>
        <th>Краткое<br>наименование</th>
      </tr>
      <tr class="letters"><td>А</td><td>1</td><td>1а</td><td>1б</td><td>2</td><td>2а</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td><td>9</td><td>10</td><td>10а</td><td>11</td></tr>
    </thead>
    <tbody>
      ${itemRows}
      <tr class="totals">
        <td></td>
        <td class="label" colspan="7">Всего к оплате</td>
        <td class="n">${money(totals.withoutVat)}</td>
        <td class="c">X</td>
        <td></td>
        <td class="n">${totals.vatNone ? 'без НДС' : money(totals.vat)}</td>
        <td class="n">${money(totals.withVat)}</td>
        <td colspan="3"></td>
      </tr>
    </tbody>
  </table>

  <div class="signature-block">
  <div class="abs" style="left:79.3pt;top:0pt;height:61.6pt;border-left:0.75pt solid #000"></div>
  <div class="abs" style="left:827.2pt;top:0pt;height:61.6pt;border-left:0.75pt solid #000"></div>
  <div class="abs" style="left:79.3pt;top:61.6pt;width:747.9pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:421.4pt;top:101.8pt;height:154.1pt;border-left:0.75pt solid #000"></div>

  <div class="abs" style="left:16pt;top:1.3pt;width:64pt;font-size:6.4pt;line-height:7.6pt">
    Документ<br>составлен на<br><span style="display:inline-block;border-bottom:0.6pt solid #000;min-width:26pt">${options.pageCount ?? 1}</span> листах
  </div>

  <div class="abs" style="left:87.5pt;top:2.8pt;font-size:6.4pt;line-height:7.6pt">Руководитель организации<br>или иное уполномоченное лицо</div>
  <div class="abs" style="left:312.59pt;top:10pt;width:132.04pt;font-size:6.5pt;text-align:center">${directorSigner?.fio ? e(directorSigner.fio) : ''}</div>
  <div class="abs" style="left:233.82pt;top:18.58pt;width:59.27pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:312.59pt;top:18.58pt;width:132.04pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:203.45pt;top:20.64pt;width:120pt;font-size:5.6pt;text-align:center">(подпись)</div>
  <div class="abs" style="left:318.61pt;top:20.64pt;width:120pt;font-size:5.6pt;text-align:center">(ф.и.о.)</div>

  <div class="abs" style="left:461.9pt;top:2.8pt;font-size:6.4pt;line-height:7.6pt">Главный бухгалтер<br>или иное уполномоченное лицо</div>
  <div class="abs" style="left:707.21pt;top:10pt;width:115.54pt;font-size:6.5pt;text-align:center">${accountantSigner?.fio ? e(accountantSigner.fio) : ''}</div>
  <div class="abs" style="left:615.68pt;top:18.58pt;width:69.03pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:707.21pt;top:18.58pt;width:115.54pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:590.2pt;top:20.64pt;width:120pt;font-size:5.6pt;text-align:center">(подпись)</div>
  <div class="abs" style="left:704.98pt;top:20.64pt;width:120pt;font-size:5.6pt;text-align:center">(ф.и.о.)</div>

  <div class="abs" style="left:87.5pt;top:29pt;font-size:6.4pt;line-height:7.6pt">Индивидуальный предприниматель<br>или иное уполномоченное лицо</div>
  <div class="abs" style="left:320.66pt;top:44pt;width:116pt;font-size:7pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sellerIsIp ? dash(signerOfType(signers, '1')?.fio ?? seller.name) : ''}</div>
  <div class="abs" style="left:233.82pt;top:51.8pt;width:59.27pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:312.59pt;top:51.8pt;width:132.04pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:203.45pt;top:53.85pt;width:120pt;font-size:5.6pt;text-align:center">(подпись)</div>
  <div class="abs" style="left:318.61pt;top:53.85pt;width:120pt;font-size:5.6pt;text-align:center">(ф.и.о.)</div>

  <div class="abs" style="left:466.4pt;top:36.5pt;font-size:6.6pt">${sellerIsIp ? ogrnText(seller) : ''}</div>
  <div class="abs" style="left:464.14pt;top:51.65pt;width:358.61pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:461.9pt;top:54.6pt;font-size:5.6pt;line-height:6.4pt">(основной государственный регистрационный номер индивидуального предпринимателя и дата присвоения такого номера)</div>

  <div class="abs" style="left:16.25pt;top:66.55pt;font-size:7pt;white-space:nowrap">Основание передачи (сдачи)/получения приемки</div>
  <div class="abs" style="left:183.55pt;top:66.55pt;width:644.45pt;font-size:7pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${basisText(transfer)}</div>
  <div class="abs" style="left:183.55pt;top:73.88pt;width:644.45pt;border-top:0.6pt solid #000"></div>
  <div class="abs" style="left:461pt;top:77.7pt;font-size:6pt">(договор; доверенность и др.)</div>

  <div class="abs" style="left:16.25pt;top:84.56pt;font-size:7pt;white-space:nowrap">Данные о транспортировке и грузе</div>
  <div class="abs" style="left:137.04pt;top:84.56pt;width:690.96pt;font-size:6.4pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e(transfer?.transport?.description ?? '')}${transfer?.transport?.incoterms ? `, ${e(transfer.transport.incoterms)}` : ''}</div>
  <div class="abs" style="left:137.04pt;top:91.88pt;width:690.96pt;border-top:0.6pt solid #000"></div>
  <div class="abs" style="left:137.04pt;top:95pt;width:690.96pt;font-size:6pt;text-align:center">(транспортная накладная, поручение экспедитору, экспедиторская/складская расписка и др./масса нетто/брутто груза, если не приведены ссылки на транспортные документы, содержащие эти сведения)</div>

  <div class="abs" style="left:17.8pt;top:104.07pt;font-size:7pt">Товар (груз) передал/услуги, результаты работ, права сдал</div>
  <div class="abs" style="left:15.5pt;top:116.07pt;width:159.8pt;font-size:6.4pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center">${transferor?.position ? e(transferor.position) : ''}</div>
  <div class="abs" style="left:296.27pt;top:116.07pt;width:115.91pt;font-size:7pt;white-space:nowrap">${transferor?.fio ? e(transferor.fio) : ''}</div>
  <div class="abs" style="left:15.5pt;top:123.94pt;width:159.8pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:194.81pt;top:123.94pt;width:79.52pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:293.84pt;top:123.94pt;width:120.78pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:15.5pt;top:126.1pt;width:159.8pt;font-size:6pt;text-align:center">(должность)</div>
  <div class="abs" style="left:194.81pt;top:126.1pt;width:79.52pt;font-size:6pt;text-align:center">(подпись)</div>
  <div class="abs" style="left:293.84pt;top:126.1pt;width:120.78pt;font-size:6pt;text-align:center">(ф.и.о.)</div>
  <div class="abs" style="left:17.8pt;top:134.8pt;font-size:7pt;white-space:nowrap">Дата отгрузки, передачи (сдачи)</div>
  <div class="abs" style="left:207.6pt;top:134.8pt;font-size:7pt;white-space:nowrap">«</div>
  <div class="abs" style="left:217.2pt;top:134.8pt;font-size:7pt;white-space:nowrap">${transferDay || '&nbsp;'}</div>
  <div class="abs" style="left:230.1pt;top:134.8pt;font-size:7pt;white-space:nowrap">»</div>
  <div class="abs" style="left:253.5pt;top:134.8pt;font-size:7pt;white-space:nowrap">${transferMonth || ''}</div>
  <div class="abs" style="left:295.3pt;top:134.8pt;font-size:7pt;white-space:nowrap">20</div>
  <div class="abs" style="left:308.8pt;top:134.8pt;font-size:7pt;white-space:nowrap">${transferYear || '__'}</div>
  <div class="abs" style="left:321.6pt;top:134.8pt;font-size:7pt;white-space:nowrap">г.</div>
  <div class="abs" style="left:212.7pt;top:143.2pt;width:16.6pt;border-top:0.6pt solid #000"></div>
  <div class="abs" style="left:235.4pt;top:143.2pt;width:59pt;border-top:0.6pt solid #000"></div>
  <div class="abs" style="left:304.2pt;top:143.2pt;width:16.5pt;border-top:0.6pt solid #000"></div>
  ${transferMonth ? '' : '<div class="abs" style="left:249.5pt;top:142.4pt;width:80pt;border-top:0.6pt solid #000"></div>'}

  <div class="abs" style="left:430.79pt;top:104.07pt;font-size:7pt">Товар (груз) получил/услуги, результаты работ, права принял</div>
  <div class="abs" style="left:428.7pt;top:116.07pt;width:159.8pt;font-size:6.4pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center">${demo ? DEMO_RECEIPT.position : ''}</div>
  <div class="abs" style="left:706.9pt;top:116.07pt;width:119.5pt;font-size:6.4pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center">${demo ? DEMO_RECEIPT.fio : ''}</div>
  <div class="abs" style="left:428.7pt;top:123.94pt;width:159.8pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:608pt;top:123.94pt;width:79.5pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:706.9pt;top:123.94pt;width:119.5pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:428.7pt;top:126.1pt;width:159.8pt;font-size:6pt;text-align:center">(должность)</div>
  <div class="abs" style="left:608pt;top:126.1pt;width:79.5pt;font-size:6pt;text-align:center">(подпись)</div>
  <div class="abs" style="left:706.9pt;top:126.1pt;width:119.5pt;font-size:6pt;text-align:center">(ф.и.о.)</div>
  <div class="abs" style="left:430.79pt;top:134.8pt;font-size:7pt;white-space:nowrap">Дата получения (приемки)</div>
  <div class="abs" style="left:599.6pt;top:134.8pt;font-size:7pt;white-space:nowrap">«</div>
  <div class="abs" style="left:611.6pt;top:134.8pt;font-size:7pt;white-space:nowrap">${demo ? receiptDay : ''}</div>
  <div class="abs" style="left:622.1pt;top:134.8pt;font-size:7pt;white-space:nowrap">»</div>
  <div class="abs" style="left:632pt;top:134.8pt;font-size:7pt;white-space:nowrap">${demo ? receiptMonth : ''}</div>
  <div class="abs" style="left:632pt;top:142.4pt;width:52pt;border-top:0.6pt solid #000"></div>
  <div class="abs" style="left:687.4pt;top:134.8pt;font-size:7pt;white-space:nowrap">${demo ? `20${receiptYear}` : '20__'} г.</div>

  <div class="abs" style="left:16.25pt;top:145.3pt;width:360pt;font-size:7pt">Иные сведения об отгрузке, передаче</div>
  <div class="abs info-value" style="left:145pt;top:143.2pt;width:250pt;font-size:6.2pt">${e(infoText(transfer?.info ?? []))}</div>
  <div class="abs" style="left:430.79pt;top:145.3pt;width:390pt;font-size:7pt">Иные сведения о получении, приемке</div>
  <div class="abs info-value" style="left:560pt;top:143.2pt;width:253pt;font-size:6.2pt">${demo ? DEMO_RECEIPT.note : ''}</div>
  <div class="abs" style="left:15.5pt;top:158.7pt;width:399.2pt;border-bottom:0.6pt solid #000;height:8pt"></div>
  <div class="abs" style="left:428.7pt;top:158.7pt;width:397.7pt;border-bottom:0.6pt solid #000;height:8pt"></div>
  <div class="abs" style="left:84pt;top:168.1pt;width:360pt;font-size:6pt">(ссылки на неотъемлемые приложения, сопутствующие документы, иные документы и т.п.)</div>
  <div class="abs" style="left:461pt;top:168.1pt;width:360pt;font-size:6pt">(информация о наличии/отсутствии претензии; ссылки на неотъемлемые приложения и другие документы и т.п.)</div>

  <div class="abs" style="left:15.5pt;top:187.58pt;width:399.12pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:428.88pt;top:187.58pt;width:397.62pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:16.25pt;top:179.8pt;width:395pt;font-size:7pt">${partyBank(seller)}</div>
  <div class="abs" style="left:429.29pt;top:179.8pt;width:395pt;font-size:7pt">${partyBank(buyer)}</div>
  <div class="abs" style="left:16.25pt;top:189.8pt;width:395pt;font-size:6pt;text-align:center">(банковские реквизиты продавца)</div>
  <div class="abs" style="left:429.29pt;top:189.8pt;width:395pt;font-size:6pt;text-align:center">(банковские реквизиты покупателя)</div>

  <div class="abs" style="left:17.8pt;top:198.6pt;font-size:7pt">Ответственный за правильность оформления факта хозяйственной жизни</div>
  <div class="abs" style="left:15.5pt;top:210.6pt;width:140.3pt;font-size:7pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center">${sellerIsIp ? 'ИП' : (signer?.position?.trim() ? e(signer.position) : 'Руководитель организации')}</div>
  <div class="abs" style="left:282.02pt;top:210.6pt;width:132.6pt;font-size:7pt;white-space:nowrap">${dash(signer?.fio ?? seller?.name)}</div>
  <div class="abs" style="left:15.5pt;top:218.3pt;width:140.3pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:173.05pt;top:218.3pt;width:75.02pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:265.33pt;top:218.3pt;width:149.29pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:15.5pt;top:220.6pt;width:140.3pt;font-size:6pt;text-align:center">(должность)</div>
  <div class="abs" style="left:173.05pt;top:220.6pt;width:75.02pt;font-size:6pt;text-align:center">(подпись)</div>
  <div class="abs" style="left:265.33pt;top:220.6pt;width:149.29pt;font-size:6pt;text-align:center">(ф.и.о.)</div>

  <div class="abs" style="left:430.79pt;top:198.6pt;font-size:7pt">Ответственный за правильность оформления факта хозяйственной жизни</div>
  <div class="abs" style="left:428.7pt;top:218.3pt;width:159.8pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:608pt;top:218.3pt;width:79.5pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:706.9pt;top:218.3pt;width:119.5pt;border-top:0.75pt solid #000"></div>
  <div class="abs" style="left:428.7pt;top:220.6pt;width:159.8pt;font-size:6pt;text-align:center">(должность)</div>
  <div class="abs" style="left:608pt;top:220.6pt;width:79.5pt;font-size:6pt;text-align:center">(подпись)</div>
  <div class="abs" style="left:706.9pt;top:220.6pt;width:119.5pt;font-size:6pt;text-align:center">(ф.и.о.)</div>

  <div class="abs" style="left:17.75pt;top:229.4pt;width:395pt;font-size:7pt;line-height:8.2pt">Наименование экономического субъекта — составителя документа (в т. ч. комиссионера/агента)</div>
  <div class="abs" style="left:17.75pt;top:238.4pt;width:395pt;font-size:7pt">${e(meta.organization ?? '')}</div>
  <div class="abs" style="left:15.5pt;top:246.12pt;width:399.12pt;border-top:0.6pt solid #000"></div>
  <div class="abs" style="left:430.79pt;top:229.4pt;width:395pt;font-size:7pt;line-height:8.2pt">Наименование экономического субъекта — составителя документа</div>
  <div class="abs" style="left:430.79pt;top:238.4pt;width:395pt;font-size:7pt"></div>
  <div class="abs" style="left:428.88pt;top:244.62pt;width:397.62pt;border-top:0.6pt solid #000"></div>
  </div>
</div></body></html>`;
}
