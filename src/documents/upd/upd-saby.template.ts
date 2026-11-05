import { escapeHtml, formatRate } from '../shared/format';
import type { PartyModel } from '../shared/party';
import type { UpdPrintModel, UpdRow, UpdTransfer } from './upd.model';

export interface UpdSabyOptions {
  readonly fontCss: string;
}

const e = (value: string | undefined | null): string => escapeHtml(value ?? '');
const dash = (value: string | undefined): string => (value?.trim() ? e(value.trim()) : '-');

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function dateRu(value: string | undefined): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value?.trim() ?? '');
  if (!match) return dash(value);
  return `${Number(match[1])} ${MONTHS[Number(match[2]) - 1] ?? ''} ${match[3]} г.`;
}

function dateShort(value: string | undefined): string {
  return value?.trim() ? e(value.trim()) : '---';
}

/** 80000.00 -> 80 000.00; sums in this form use space grouping and dot decimals. */
function money(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return '-';
  const normalized = raw.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return e(raw);
  const negative = normalized.startsWith('-');
  const [integer, fraction = ''] = normalized.replace('-', '').split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const decimals = (fraction + '00').slice(0, 2);
  return `${negative ? '-' : ''}${grouped}.${decimals}`;
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
  if (!bank) return '-';
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
<td class="n">${money(row.vatAmount)}</td>
<td class="n">${money(row.amountWithVat)}</td>
<td class="c">${dash(row.countryCode)}</td>
<td class="c">${dash(row.countryNames[0])}</td>
<td class="c">${dash(row.customsNumbers[0])}</td>`;
}

const TABLE_COLUMNS = [65.27, 16.51, 139.54, 39.76, 16.51, 44.26, 42.76, 39.76, 57.02, 40.51, 30.76, 55.52, 57.02, 39.76, 39.76, 80.28];

export function renderUpdSabyHtml(model: UpdPrintModel, options: UpdSabyOptions): string {
  const { meta, parties, invoice, rows, totals, transfer, signers } = model;
  const seller = parties.sellers[0];
  const buyer = parties.buyers[0];
  const shipper = parties.shippers[0];
  const consignee = parties.consignees[0];
  const signer = signers[0];
  const shift = 18 * Math.max(rows.length - 1, 0);

  const [transferDay, transferMonth, transferYear] = dateParts(transfer?.date);
  const payment = invoice.paymentDocuments[0];
  const shipment = invoice.shipmentDocuments[0];
  const itemRows = rows.length
    ? rows.map((row) => `<tr>${itemCells(row)}</tr>`).join('')
    : `<tr>${Array.from({ length: 16 }, (_, index) => `<td class="${index === 2 ? 'name' : 'c'}">-</td>`).join('')}</tr>`;

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>УПД ${e(meta.number)}</title>
<style>
${options.fontCss}
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Tahoma', 'Liberation Sans', Arial, sans-serif; font-size: 7pt; line-height: 1.15; color: #000; }
.page { position: relative; width: 841.92pt; height: 594.96pt; overflow: hidden; }
.abs { position: absolute; }
.band { position: absolute; left: 14pt; top: 17.5pt; width: 64pt; font-size: 6.5pt; line-height: 8.5pt; border-right: 0.75pt solid #000; }
.band .upd-title { margin-bottom: 4pt; }
.status-row { margin-top: 6.7pt; display: flex; align-items: center; font-size: 6.5pt; }
.status-box { display: inline-block; border: 0.7pt solid #000; padding: 0 2pt; margin-left: 10pt; font-size: 6.5pt; line-height: 8pt; }
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
table.items { position: absolute; left: 14pt; top: 190.3pt; width: 805pt; table-layout: fixed; border-collapse: collapse; }
table.items th, table.items td { border: 0.75pt solid #000; padding: 1pt 1.5pt; vertical-align: middle; }
table.items th { font-weight: normal; font-size: 6pt; line-height: 7.4pt; text-align: center; vertical-align: top; padding-top: 2pt; }
table.items tr.h1 th { height: 44.1pt; }
table.items tr.h2 th { height: 25pt; }
table.items td { font-size: 7pt; height: 18pt; padding: 0.6pt 1.5pt; }
table.items td.c { text-align: center; }
table.items td.n { text-align: right; white-space: nowrap; }
table.items td.name { text-align: left; }
table.items tr.letters td { font-size: 6.5pt; text-align: center; height: 11.25pt; }
table.items tr.totals td { height: 11.26pt; font-size: 7pt; padding: 0.6pt 1.5pt; }
table.items tr.totals td.label { text-align: left; font-size: 7.5pt; font-weight: bold; padding-left: 3.5pt; }
table.items tr.totals td { font-weight: normal; }
.letters-label { font-weight: normal; }
.bottom { position: absolute; left: 14pt; width: 805.5pt; }
.line-row { display: flex; align-items: flex-end; gap: 4pt; }
.line-row .grow { flex: 1; border-bottom: 0.6pt solid #000; height: 8.5pt; }
.caption-center { text-align: center; font-size: 6pt; }
.two-col { display: flex; gap: 8pt; }
.two-col > div { flex: 1; }
.signature-line { border-bottom: 0.6pt solid #000; height: 8.5pt; }
</style></head>
<body><div class="page">
  <div class="band">
    <div class="upd-title">Универсальный<br>передаточный<br>документ</div>
    <div class="status-row"><strong>Статус:</strong><span class="status-box">1</span></div>
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
  <div class="abs row-value hv" style="top:71.3pt">${shipper ? `${e(shipper.name)}, ${e(shipper.address ?? '')}` : '-'}</div>
  <div class="abs row-marker" style="top:71.3pt">(3)</div>

  <div class="abs row-label" style="top:81.8pt">Грузополучатель и его адрес:</div>
  <div class="abs row-value hv" style="top:81.8pt">${consignee ? `${e(consignee.name)}, ${e(consignee.address ?? '')}` : '-'}</div>
  <div class="abs row-marker" style="top:81.8pt">(4)</div>

  <div class="abs row-label" style="top:92.3pt">К платежно-расчетному документу</div>
  <div class="abs row-value hv" style="top:92.3pt">${payment ? `№ ${dash(payment.number)} от ${dash(payment.date)}` : '-'}</div>
  <div class="abs row-marker" style="top:92.3pt">(5)</div>

  <div class="abs row-label" style="top:102.8pt">Документ об отгрузке:</div>
  <div class="abs row-value hv" style="top:102.8pt">${shipment ? `${e(shipment.kind ?? shipment.name ?? '')}, № ${e(shipment.number ?? '')} от ${e(shipment.date ?? '')}` : '-'}</div>
  <div class="abs row-marker" style="top:102.8pt">(5а)</div>

  <div class="abs row-label" style="top:112pt;width:500pt;font-size:6pt;line-height:8.3pt">К счету-фактуре (счетам-фактурам), выставленному (выставленным) при получении оплаты, частичной оплаты или иных платежей в счет предстоящих поставок товаров (выполнения работ, оказания услуг), передачи имущественных прав</div>
  <div class="abs" style="top:120.3pt;left:585.7pt;width:20pt;font-size:7pt">-</div>
  <div class="abs row-marker" style="top:112pt">(5б)</div>

  <div class="abs row-label bold" style="top:132.1pt">Покупатель</div>
  <div class="abs row-value hv bold" style="top:132.1pt">${partyShort(buyer)}</div>
  <div class="abs row-marker" style="top:132.1pt">(6)</div>

  <div class="abs row-label" style="top:141.8pt">Адрес</div>
  <div class="abs row-value hv" style="top:141.8pt">${dash(buyer?.address)}</div>
  <div class="abs row-marker" style="top:141.8pt">(6а)</div>

  <div class="abs row-label" style="top:151.6pt">ИНН/КПП покупателя</div>
  <div class="abs row-value hv" style="top:151.6pt">${partyInn(buyer)}</div>
  <div class="abs row-marker" style="top:151.6pt">(6б)</div>

  <div class="abs row-label" style="top:162.1pt">Валюта: наименование, код</div>
  <div class="abs row-value hv" style="top:162.1pt">${e(meta.currency.name ?? '')}${meta.currency.code ? `, код - ${e(meta.currency.code)}` : ''}</div>
  <div class="abs row-marker" style="top:162.1pt">(7)</div>

  <div class="abs row-label" style="top:172.6pt;width:710pt">Идентификатор государственного контракта, договора (соглашения) (при наличии)</div>
  <div class="abs row-value hv" style="top:172.6pt">${invoice.gosContractId?.trim() ? e(invoice.gosContractId) : ''}</div>
  <div class="abs row-marker" style="top:172.6pt">(8)</div>

  <table class="items">
    <colgroup>${TABLE_COLUMNS.map((width) => `<col style="width:${width}pt">`).join('')}</colgroup>
    <thead>
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
        <th rowspan="2">Регистрационный номер декларации на товары или регистрационный номер партии товара, подлежащего прослеживаемости</th>
      </tr>
      <tr class="h2">
        <th>код</th>
        <th>условное<br>обозначение<br>(национальное)</th>
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
        <td class="n">${money(totals.vat)}</td>
        <td class="n">${money(totals.withVat)}</td>
        <td colspan="3"></td>
      </tr>
    </tbody>
  </table>

  <div class="abs" style="left:0;top:${shift}pt;width:841.92pt;height:300pt">
  <div class="abs" style="left:16pt;top:301.8pt;width:64pt;font-size:6.4pt;line-height:7.6pt">
    Документ<br>составлен на<br><span style="display:inline-block;border-bottom:0.6pt solid #000;min-width:26pt">&nbsp;</span> листах
  </div>

  <div class="abs" style="left:87.5pt;top:303.3pt;width:340pt;font-size:6.4pt;line-height:7.6pt">
    <div>Руководитель организации<br>или иное уполномоченное лицо</div>
    <div style="position:relative;height:1pt;margin-top:2pt">
      <span style="position:absolute;left:142pt;width:60pt;border-bottom:0.7pt solid #000"></span>
      <span style="position:absolute;left:252pt;width:70pt;border-bottom:0.7pt solid #000"></span>
    </div>
    <div style="position:relative;height:6pt;font-size:5.6pt;margin-top:1pt">
      <span style="position:absolute;left:168pt">(подпись)</span>
      <span style="position:absolute;left:284pt">(ф.и.о.)</span>
    </div>
  </div>
  <div class="abs" style="left:461.9pt;top:303.3pt;width:340pt;font-size:6.4pt;line-height:7.6pt">
    <div>Главный бухгалтер<br>или иное уполномоченное лицо</div>
    <div style="position:relative;height:1pt;margin-top:2pt">
      <span style="position:absolute;left:142pt;width:60pt;border-bottom:0.7pt solid #000"></span>
      <span style="position:absolute;left:252pt;width:70pt;border-bottom:0.7pt solid #000"></span>
    </div>
    <div style="position:relative;height:6pt;font-size:5.6pt;margin-top:1pt">
      <span style="position:absolute;left:168pt">(подпись)</span>
      <span style="position:absolute;left:284pt">(ф.и.о.)</span>
    </div>
  </div>

  <div class="abs" style="left:87.5pt;top:329.6pt;width:340pt;font-size:6.4pt;line-height:7.6pt">
    <div>Индивидуальный предприниматель<br>или иное уполномоченное лицо</div>
    <div style="position:relative;height:9pt;margin-top:2pt">
      <span style="position:absolute;left:142pt;width:60pt;border-bottom:0.7pt solid #000;height:9pt"></span>
      <span style="position:absolute;left:252pt;width:90pt;border-bottom:0.7pt solid #000;height:9pt;font-size:7pt;text-align:center;line-height:8pt;white-space:nowrap">${seller?.kind === 'ИП' ? dash(signer?.fio ?? seller.name) : ''}</span>
    </div>
    <div style="position:relative;height:6pt;font-size:5.6pt;margin-top:1pt">
      <span style="position:absolute;left:168pt">(подпись)</span>
      <span style="position:absolute;left:284pt">(ф.и.о.)</span>
    </div>
  </div>
  <div class="abs" style="left:461.9pt;top:337.1pt;width:300pt">
    <div style="font-size:6.6pt">${seller?.kind === 'ИП' ? ogrnText(seller) : ''}</div>
    <div style="font-size:5.6pt;line-height:6.4pt;margin-top:2pt">(основной государственный регистрационный номер индивидуального предпринимателя и дата присвоения такого номера)</div>
  </div>

  <div class="abs" style="left:14pt;top:367.1pt;width:790pt">
    <div class="line-row" style="font-size:7pt"><span style="white-space:nowrap">Основание передачи (сдачи)/получения приемки</span><span class="grow" style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${basisText(transfer)}</span></div>
    <div style="padding-left:445pt;font-size:6pt;margin-top:2pt">(договор; доверенность и др.)</div>
  </div>

  <div class="abs" style="left:14pt;top:385.1pt;width:790pt">
    <div class="line-row"><span>Данные о транспортировке и грузе</span><span class="grow"></span></div>
    <div style="font-size:6pt">(транспортная накладная, поручение экспедитору, экспедиторская/складская расписка и др./масса нетто/брутто груза, если не приведены ссылки на транспортные документы, содержащие эти сведения)</div>
  </div>

  <div class="abs" style="left:14pt;top:406pt;width:395pt">
    <div>Товар (груз) передал/услуги, результаты работ, права сдал</div>
    <div style="position:relative;height:11.5pt;margin-top:2pt">
      <span style="position:absolute;left:63.6pt;width:84pt;border-bottom:0.7pt solid #000;height:9.5pt"></span>
      <span style="position:absolute;left:205.9pt;width:84pt;border-bottom:0.7pt solid #000;height:9.5pt"></span>
      <span style="position:absolute;left:292.5pt;width:110pt;border-bottom:0.7pt solid #000;height:9.5pt;font-size:7pt;text-align:left;line-height:8pt;white-space:nowrap">${transfer?.person?.fio ? e(transfer.person.fio) : ''}</span>
    </div>
    <div style="position:relative;height:6pt;font-size:6pt">
      <span style="position:absolute;left:63.6pt">(должность)</span>
      <span style="position:absolute;left:205.9pt">(подпись)</span>
      <span style="position:absolute;left:326.6pt">(ф.и.о.)</span>
    </div>
    <div style="margin-top:4pt;display:flex;align-items:baseline;gap:4pt">
      <span style="white-space:nowrap;width:188pt;display:inline-block">Дата отгрузки, передачи (сдачи)</span>
      <span>« ${transferDay || '&nbsp;&nbsp;'} » ${transferMonth || '____________'} 20${transferYear || '__'} г.</span>
    </div>

  </div>
  <div class="abs" style="left:420pt;top:406pt;width:395pt">
    <div>Товар (груз) получил/услуги, результаты работ, права принял</div>
    <div style="position:relative;height:11.5pt;margin-top:2pt">
      <span style="position:absolute;left:61.2pt;width:84pt;border-bottom:0.7pt solid #000;height:9.5pt"></span>
      <span style="position:absolute;left:196pt;width:84pt;border-bottom:0.7pt solid #000;height:9.5pt"></span>
      <span style="position:absolute;left:321.6pt;width:92pt;border-bottom:0.7pt solid #000;height:9.5pt"></span>
    </div>
    <div style="position:relative;height:6pt;font-size:6pt">
      <span style="position:absolute;left:61.2pt">(должность)</span>
      <span style="position:absolute;left:196pt">(подпись)</span>
      <span style="position:absolute;left:321.6pt">(ф.и.о.)</span>
    </div>
    <div style="margin-top:4pt;display:flex;align-items:baseline;gap:4pt">
      <span style="white-space:nowrap;width:170pt;display:inline-block">Дата получения (приемки)</span>
      <span>« &nbsp;&nbsp; » ____________ 20__ г.</span>
    </div>

  </div>

  <div class="abs" style="left:17pt;top:446pt;width:360pt;font-size:7pt">Иные сведения об отгрузке, передаче</div>
  <div class="abs" style="left:425.5pt;top:446pt;width:390pt;font-size:7pt">Иные сведения о получении, приемке</div>
  <div class="abs" style="left:17pt;top:455pt;width:380pt;border-bottom:0.6pt solid #000;height:8pt"></div>
  <div class="abs" style="left:425.5pt;top:455pt;width:390pt;border-bottom:0.6pt solid #000;height:8pt"></div>
  <div class="abs" style="left:84pt;top:468.6pt;width:360pt;font-size:6pt">(ссылки на неотъемлемые приложения, сопутствующие документы, иные документы и т.п.)</div>
  <div class="abs" style="left:461pt;top:468.6pt;width:360pt;font-size:6pt">(информация о наличии/отсутствии претензии; ссылки на неотъемлемые приложения и другие документы и т.п.)</div>

  <div class="abs" style="left:14pt;top:481pt;width:395pt;font-size:7pt">${partyBank(seller)}</div>
  <div class="abs" style="left:420pt;top:481pt;width:395pt;font-size:7pt">${partyBank(buyer)}</div>
  <div class="abs" style="left:14pt;top:489pt;width:395pt;font-size:6pt;text-align:center">(банковские реквизиты продавца)</div>
  <div class="abs" style="left:420pt;top:489pt;width:395pt;font-size:6pt;text-align:center">(банковские реквизиты покупателя)</div>

  <div class="abs" style="left:14pt;top:502.1pt;width:395pt">
    <div>Ответственный за правильность оформления факта хозяйственной жизни</div>
    <div style="position:relative;height:11.5pt;margin-top:2pt">
      <span style="position:absolute;left:16pt;width:120pt;border-bottom:0.7pt solid #000;height:9.5pt;font-size:6.5pt;line-height:8pt;text-align:center;white-space:nowrap">Индивидуальный предприниматель</span>
      <span style="position:absolute;left:205.9pt;width:84pt;border-bottom:0.7pt solid #000;height:9.5pt"></span>
      <span style="position:absolute;left:292.5pt;width:110pt;border-bottom:0.7pt solid #000;height:9.5pt;font-size:7pt;text-align:left;line-height:8pt;white-space:nowrap">${dash(signer?.fio ?? seller?.name)}</span>
    </div>
    <div style="position:relative;height:6pt;font-size:6pt">
      <span style="position:absolute;left:63.6pt">(должность)</span>
      <span style="position:absolute;left:205.9pt">(подпись)</span>
      <span style="position:absolute;left:326.6pt">(ф.и.о.)</span>
    </div>
  </div>
  <div class="abs" style="left:420pt;top:502.1pt;width:395pt">
    <div>Ответственный за правильность оформления факта хозяйственной жизни</div>
    <div style="position:relative;height:11.5pt;margin-top:2pt">
      <span style="position:absolute;left:61.2pt;width:84pt;border-bottom:0.7pt solid #000;height:9.5pt"></span>
      <span style="position:absolute;left:196pt;width:84pt;border-bottom:0.7pt solid #000;height:9.5pt"></span>
      <span style="position:absolute;left:321.6pt;width:92pt;border-bottom:0.7pt solid #000;height:9.5pt"></span>
    </div>
    <div style="position:relative;height:6pt;font-size:6pt">
      <span style="position:absolute;left:61.2pt">(должность)</span>
      <span style="position:absolute;left:196pt">(подпись)</span>
      <span style="position:absolute;left:321.6pt">(ф.и.о.)</span>
    </div>
  </div>

  <div class="abs" style="left:14pt;top:532.2pt;width:395pt;font-size:6pt">
    <div>Наименование экономического субъекта — составителя документа (в т. ч. комиссионера/агента)</div>
    <div style="font-size:7pt;margin-top:2pt">${e(meta.organization ?? '')}</div>
  </div>
  <div class="abs" style="left:420pt;top:532.2pt;width:395pt;font-size:6pt">
    <div>Наименование экономического субъекта — составителя документа</div>
    <div style="font-size:7pt">${buyer ? partyShort(buyer) : ''}</div>
  </div>
  </div>
</div></body></html>`;
}
