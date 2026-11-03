import { escapeHtml, formatMoney, formatQuantity, formatRate } from '../shared/format';
import type { PartyModel } from '../shared/party';
import { formatPartyForPrint } from '../shared/party-print';
import type { Amounts, Discrepancy, Torg2PrintModel } from './torg2.model';

const e = (value: string | undefined | null): string => escapeHtml(value ?? '');
const blank = (value: string | undefined): string => (value?.trim() ? e(value) : '');

function money(value: string | undefined): string {
  return blank(formatMoney(value));
}

function quantity(value: string | undefined): string {
  return blank(formatQuantity(value));
}

function partyText(party: PartyModel | undefined): string {
  if (!party) return '';
  const info = formatPartyForPrint(party);
  return e([info.title, ...info.lines].filter(Boolean).join(', '));
}

function partyMarkup(party: PartyModel | undefined): string {
  if (!party) return '';
  const info = formatPartyForPrint(party);
  return `<strong>${e(info.title)}</strong>${info.lines.length ? `, ${e(info.lines.join(', '))}` : ''}`;
}



function dateParts(value: string | undefined): [string, string, string] {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value ?? '');
  return match ? [match[1], match[2], match[3]] : ['', '', ''];
}

function amountsCells(amounts: Amounts | undefined): string {
  return `<td class="num">${quantity(amounts?.quantity)}</td>
<td class="num">${money(amounts?.price)}</td>
<td class="num">${money(amounts?.amountWithVat)}</td>
<td class="num">${amounts?.vatRate ? e(formatRate(amounts.vatRate)) : ''}</td>
<td class="num">${money(amounts?.vatAmount)}</td>`;
}

function discrepancyCells(value: Discrepancy | undefined): string {
  return `<td class="num">${quantity(value?.quantity)}</td>
<td class="num">${money(value?.amountWithVat)}</td>
<td class="num">${money(value?.vatAmount)}</td>
<td>${blank(value?.note)}</td>`;
}

function line(label: string, value = '', className = ''): string {
  return `<div class="form-line ${className}"><span>${e(label)}</span><span class="line-value">${value}</span></div>`;
}

const SCOPE_LABELS: Record<string, string> = {
  '1': 'лицо, принявшее ценности',
  '2': 'лицо, принявшее ценности и ответственное за оформление события (операции)',
  '3': 'лицо, ответственное за оформление события (операции)',
  '7': 'председатель комиссии',
  '8': 'член комиссии',
};

const STATUS_LABELS: Record<string, string> = {
  '3': 'работник иной уполномоченной организации',
  '4': 'уполномоченное физическое лицо (в том числе индивидуальный предприниматель)',
  '5': 'работник организации-покупателя',
  '6': 'работник организации — составителя файла обмена информации покупателя',
};

function decodedCode(labels: Record<string, string>, code: string | undefined): string {
  if (!code) return '';
  const label = labels[code.trim()];
  return label ? `${label} (код ${code.trim()})` : `код ${code.trim()}`;
}

export interface Torg2TemplateOptions {
  readonly fontCss: string;
  /** Match the approved Saby-style blank: no appendix/signature service blocks. */
  readonly exactReference?: boolean;
}

export function renderTorg2Html(model: Torg2PrintModel, options: Torg2TemplateOptions): string {
  const { meta, parties, basis, inspection, rows } = model;
  const exact = options.exactReference === true;
  const [inspectionDay, inspectionMonth, inspectionYear] = dateParts(inspection.date);
  const accompanying = inspection.accompanyingDocuments
    .map((doc) => `${doc.name ?? ''}, ${doc.number ?? ''}, ${doc.date ?? ''}`)
    .join('; ');
  const conclusion = model.event.conclusion?.trim();
  const openingDate = inspection.openingDate?.trim();
  const longCharacteristics = rows.filter((row) => (row.characteristic?.length ?? 0) > 120);
  const order = basis.orderNumber || basis.orderDate
    ? `приказ, распоряжение № ${basis.orderNumber ?? ''} от ${basis.orderDate ?? ''}`
    : 'приказ, распоряжение';
  const transportRows = inspection.transportDocuments
    .map(
      (doc) => `<tr class="data-row">
<td>${blank(doc.seals)}</td><td class="num">${blank(doc.places)}</td><td>${blank(doc.packaging)}</td>
<td>${blank(doc.cargoName ?? doc.name)}</td><td>${blank(doc.unitName)}</td><td class="num">${blank(doc.unitCode)}</td>
<td class="num">${blank(doc.massDocGross)}</td><td class="num">${blank(doc.massFactGross)}</td>
<td class="num">${blank(doc.massDocNet)}</td><td class="num">${blank(doc.massFactNet)}</td><td>${blank(doc.additionalId)}</td>
</tr>`,
    )
    .join('');
  const goodsRows = rows
    .map(
      (row) => `<tr class="data-row">
<td class="center">${row.number}</td>
<td>${e(row.name)}</td>
<td>${blank(row.unitName)}</td><td class="num">${blank(row.unitCode)}</td>
<td>${blank(row.article)}</td><td>${blank(row.sort)}</td><td>${blank(row.code)}</td>
<td>${(row.characteristic?.length ?? 0) > 120 ? '<span class="muted">см. приложение</span>' : blank(row.characteristic)}</td><td class="center">${blank(row.sourceLine)}</td>
${amountsCells(row.byDocument)}${amountsCells(row.byFact)}<td>${blank(row.passport)}</td>
</tr>`,
    )
    .join('');
  const discrepancyRows = rows
    .map(
      (row) => `<tr class="data-row">
<td class="center">${row.number}</td><td>${e(row.name)}</td>
${discrepancyCells(row.defect)}${discrepancyCells(row.breakage)}
${discrepancyCells(row.shortage)}${discrepancyCells(row.surplus)}
</tr>`,
    )
    .join('');
  const signer = model.signers[0];
  const attachments = model.attachments
    .map((doc) => `${doc.kind ?? ''} № ${doc.number ?? ''} от ${doc.date ?? ''}`)
    .join('; ');
  const extraRows = rows.filter((row) => row.positiveDelta || row.negativeDelta || row.info.length || row.marking.kiz.length || row.marking.packaging.length || row.marking.transportPackaging);
  const longCharacteristicHtml = !exact && longCharacteristics.length
    ? `<section class="appendix"><h2>Характеристики товарных строк</h2><table class="grid">
<thead><tr><th>№</th><th>Товар</th><th>Характеристика</th></tr></thead><tbody>
${longCharacteristics.map((row) => `<tr><td class="center">${row.number}</td><td>${e(row.name)}</td><td>${e(row.characteristic)}</td></tr>`).join('')}
</tbody></table></section>`
    : '';
  const extraHtml = !exact && extraRows.length
    ? `<section class="appendix"><h2>Дополнительные сведения о товарных строках</h2><table class="grid">
<thead><tr><th>№</th><th>Товар</th><th>Сведения</th></tr></thead><tbody>
${extraRows.map((row) => {
  const values = [
    ...row.info.map((item) => `${item.id}: ${item.value}`),
    row.positiveDelta ? `Положительное отклонение цены: ${row.positiveDelta.price ?? ''}; суммы: ${row.positiveDelta.amountWithVat ?? ''}; НДС: ${row.positiveDelta.vatAmount ?? ''}` : '',
    row.negativeDelta ? `Отрицательное отклонение цены: ${row.negativeDelta.price ?? ''}; суммы: ${row.negativeDelta.amountWithVat ?? ''}; НДС: ${row.negativeDelta.vatAmount ?? ''}` : '',
    row.marking.kiz.length ? `КИЗ: ${row.marking.kiz.join(', ')}` : '',
    row.marking.packaging.length ? `Упаковка: ${row.marking.packaging.join(', ')}` : '',
    row.marking.transportPackaging ? `Транспортная упаковка: ${row.marking.transportPackaging}` : '',
  ].filter(Boolean);
  return `<tr><td class="center">${row.number}</td><td>${e(row.name)}</td><td>${e(values.join('; '))}</td></tr>`;
}).join('')}
</tbody></table></section>`
    : '';
  const appendixHtml = !exact && model.appendix.length
    ? `<section class="appendix"><h2>Приложение. Реквизиты исходного XML, не вошедшие в основной бланк</h2>
${model.appendix.map((group) => `<h3>${e(group.title)}</h3><table class="grid"><thead><tr><th>Реквизит</th><th>Путь</th><th>Значение</th></tr></thead><tbody>
${group.rows.map((row) => `<tr><td>${e(row.label)}</td><td>${e(row.path)}</td><td>${e(row.value)}</td></tr>`).join('')}
</tbody></table>`).join('')}</section>`
    : '';

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>ТОРГ-2 ${e(meta.documentNumber)} от ${e(meta.documentDate)}</title>
<style>
${options.fontCss}
@page { size: A4 landscape; margin: 13mm 5mm 12mm 5mm; }
@page goods { size: A4 landscape; margin: 1mm 5mm 12mm 5mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Tahoma', 'Arial', 'Liberation Sans', sans-serif; font-size: 8pt; line-height: 1.22; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.form-page { break-after: page; }
.goods-section { break-before: page; }
.conditions-block { break-inside: avoid; margin-top: -6mm;  }
.conditions-block .section-space { margin-top: 8.6mm; }
.signatures-section { break-inside: avoid; }
.signatures-section .form-line { margin-top: 0.7mm; }
.signatures-section .section-space { margin-top: 1.2mm; }
.text-block { border-bottom: 0.6pt solid #111; padding: 1mm 0; min-height: 4mm; white-space: pre-wrap; }
.section-space { break-inside: avoid; }
.form-page:last-child { break-after: auto; }
.center { text-align: center; }
.num { text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; }
.small { font-size: 7pt; font-family: Arial, sans-serif; }
.muted { color: #444; }
.source-id { width: 62%; font-size: 7.6pt; overflow-wrap: anywhere; }
.underlined { border-bottom: 0.6pt solid #111; min-height: 3.3mm; }
.caption { text-align: center; font-size: 7pt; font-family: Arial, sans-serif; }
.party-line { margin: 0.6mm 0 0; }
.party-header { width: 48%; text-align: center; }
.party-line .label { font-weight: bold; }
.party-line .underlined { padding: 0 1mm; }
.title-block { display: grid; grid-template-columns: 135.8mm 63.5mm; gap: 1.3mm; align-items: center; width: 69.9%; margin: -2.5mm 0 -0.75mm 7.2%; }
h1 { font-size: 10pt; line-height: 1.575; text-align: right; text-transform: uppercase; margin: 0; position: relative; top: -0.45pt; }
.document-number-wrap { position: relative; }
.document-number { border-collapse: collapse; width: 63.5mm; table-layout: fixed; }
.document-number td { width: 50%; border: 0.7pt solid #111; padding: 1.1mm; text-align: center; }
.document-number .head { font-size: 8pt; line-height: 1.1; }
.document-number tr.correction td { height: 4.9mm; padding: 0 1.1mm; }
.correction-label { position: absolute; right: 100%; bottom: 0; height: 4.9mm; line-height: 4.9mm; padding-right: 1.5mm; font-size: 10pt; white-space: nowrap; }
.form-line { display: flex; align-items: flex-end; gap: 1.5mm; margin-top: 1.4mm; min-height: 3.5mm; }
.line-value { flex: 1; border-bottom: 0.6pt solid #111; padding: 0 1mm; min-height: 3.3mm; }
.line-value.empty { min-width: 35mm; }
.commission-date { display: flex; align-items: flex-end; gap: 1mm; }
.commission-date .label { margin-right: 2mm; }
.date-cell { width: 17mm; text-align: center; border-bottom: 0.6pt solid #111; }
.date-cell.year { width: 23mm; }
table { border-collapse: collapse; width: 100%; }
.grid th, .grid td { border: 0.55pt solid #111; padding: 0.7mm 0.8mm; vertical-align: middle; }
.grid th { text-align: center; font-weight: normal; font-size: 7pt; line-height: 1.15; overflow-wrap: break-word; font-family: Tahoma, Arial, sans-serif; }
.grid thead { display: table-header-group; }
.grid tbody tr { break-inside: avoid; }
.grid .numbers td { text-align: center; font-size: 6.6pt; }
.grid .data-row td { font-size: 8pt; font-family: Tahoma, Arial, sans-serif; }
.section-space { margin-top: 1.8mm; }
.page-label { text-align: right; margin-bottom: 4mm; }
.goods-section .page-label, .signatures-section .page-label { position: static; margin: 0 0 2mm; }
.goods-section { padding-top: 7mm; margin-top: -6mm; page: goods; }
.goods { table-layout: fixed; }
.goods th { font-size: 7pt; padding: 0.5mm; line-height: 1.12; }
.goods th.qty { font-size: 7pt; }
.goods .data-row td { padding: 1.1mm 0.7mm; font-size: 8pt; line-height: 1.2; overflow-wrap: break-word; font-family: Tahoma, Arial, sans-serif; }
.goods thead tr:nth-child(1) { height: 34pt; }
.goods thead tr:nth-child(2) { height: 87pt; }
.goods thead tr.numbers { height: 10pt; }
.discrepancies { table-layout: fixed; }
.discrepancies th { font-size: 7pt; padding: 0.5mm; line-height: 1.12; }
.discrepancies .data-row td { padding: 1.5mm 0.7mm; font-size: 8pt; line-height: 1.2; overflow-wrap: break-word; font-family: Tahoma, Arial, sans-serif; }
.discrepancies thead tr:nth-child(1) { height: 20pt; }
.discrepancies thead tr:nth-child(2) { height: 34pt; }
.discrepancies thead tr:nth-child(3) { height: 32pt; }
.discrepancies thead tr.numbers { height: 10pt; }
.timeline td, .timeline th { height: 11mm; }
.transport th { font-size: 6.6pt; }
.transport .data-row td { height: 8mm; }
.transport .numbers td { height: 4mm; }
.signature-grid td { border: none; border-bottom: 0.55pt solid #111; height: 3mm; }
.signature-grid .label { border-bottom: none; width: 32mm; }
.signature-captions td { border: none; text-align: center; font-size: 7pt; padding: 0 1mm 0.6mm; }
.disclaimer { margin-top: 2mm; font-size: 6.8pt; color: #333; }
.meta-note { margin-top: 1.5mm; font-size: 6.2pt; color: #444; }
.appendix { break-before: page; }
.appendix h2 { font-size: 11pt; }
.appendix h3 { font-size: 9pt; }
</style>
</head>
<body>
<section class="form-page">
  <div class="source-id">${e(meta.sourceId)}</div>
  <div class="center underlined">Идентификатор электронного документа</div>
  <div class="party-line party-header"><div class="underlined">${partyMarkup(parties.buyer)}</div><div class="caption">(организация, адрес, номер телефона)</div></div>
  <div style="height:3.7mm"></div>
  <div class="party-line party-header"><div class="underlined">${partyMarkup(parties.consignee)}</div><div class="caption">(структурное подразделение)</div></div>
  <div class="party-line"><span>Основание составления акта:</span><div class="underlined" style="margin-left:2mm;width:50%">${e(order)}</div><div class="caption" style="margin-left:2mm">(ненужное зачеркнуть)</div></div>
  <div class="title-block">
    <h1>Акт об установленном расхождении по количеству и качеству<br>при приемке товарно-материальных ценностей</h1>
    <div class="document-number-wrap">
      <table class="document-number">
        <tr class="head"><td>Номер<br>документа</td><td>Дата<br>составления</td></tr>
        <tr><td>${e(meta.documentNumber)}</td><td>${e(meta.documentDate)}</td></tr>
        <tr class="correction"><td>${blank(meta.correctionNumber)}</td><td>${blank(meta.correctionDate)}</td></tr>
      </table>
      <span class="correction-label">Исправление</span>
    </div>
  </div>
  ${line('Место приемки товара', blank(inspection.place))}
  <div class="form-line"><span>Настоящий акт составлен комиссией, которая установила:</span><div class="commission-date"><span class="date-cell">${inspectionDay}</span><span class="date-cell">${inspectionMonth}</span><span class="date-cell year">${inspectionYear}</span><span>г.</span></div></div>
  ${line('по сопроводительным документам', e(accompanying))}
  <div class="caption">(наименование, номер, дата)</div>
  ${inspection.certificates.length ? line('Сертификаты соответствия', inspection.certificates.map((item) => e(item)).join('; ')) : ''}
  ${parties.carrier ? line('Перевозчик', partyText(parties.carrier)) : ''}
  ${line('доставлен товар. Документ о вызове представителя грузоотправителя, поставщика, производителя:')}
  ${line('телеграмма, факс, телефонограмма, радиограмма №')}
  <div class="caption">(ненужное зачеркнуть)</div>
  <div style="height:8.8mm"></div>
  ${line('Грузоотправитель', partyMarkup(parties.shipper))}
  <div class="caption">(наименование, адрес, номер телефона)</div>
  ${line('Производитель')}
  <div class="caption">(наименование, адрес, номер телефона)</div>
  ${line('Поставщик', partyMarkup(parties.seller))}
  <div class="caption">(наименование, адрес, номер телефона)</div>
  ${line('Страховая компания', partyMarkup(parties.insurer))}
  <div class="caption">(наименование, адрес, номер телефона)</div>
  ${line('Договор (контракт) на поставку товара №')}
  ${line('Дата отправления товара', blank(inspection.shippingDate))}
  ${line('со станции (пристани, порта) отправления')}
  <div class="caption">(наименование)</div>
  ${line('или со склада отправителя товара')}
  <div class="caption">(наименование)</div>
</section>

<section class="form-page">
  <table class="grid timeline">
    <thead><tr><th colspan="9">ДАТА, ВРЕМЯ, ч. мин.</th></tr>
    <tr><th rowspan="2">прибытия товара на станцию (пристань, порт) назначения</th><th rowspan="2">вскрытия вагона, автофургона, контейнера и других транспортных средств</th><th rowspan="2">выдачи товара организации транспорта</th><th rowspan="2">доставки товара на склад организации-получателя</th><th rowspan="2">начала разгрузки</th><th colspan="4">приемки товара</th></tr>
    <tr><th>начало</th><th>приостановление</th><th>возобновление</th><th>окончание</th></tr></thead>
    <tbody><tr class="data-row"><td>${blank(inspection.timeline.find((item) => item.id === 'Прибытие на место назначения')?.value)}</td><td>${blank(inspection.timeline.find((item) => item.id === 'Вскрытие вагона (транспортного средства)')?.value)}</td><td>${blank(inspection.timeline.find((item) => item.id === 'Выдача груза транспортной организацией')?.value)}</td><td>${blank(inspection.timeline.find((item) => item.id === 'Доставка на склад получателя')?.value)}</td><td></td><td>${blank(inspection.timeStart)}</td><td></td><td></td><td>${blank(inspection.timeEnd)}</td></tr></tbody>
  </table>
  ${line('Сведения о состоянии вагонов, автофургонов и т. д. Наличие, описание упаковочных ярлыков, пломб транспорта на отдельных местах (сертификатов, спецификаций в вагоне, контейнере) и отправительская маркировка')}
  <div class="section-space">Сведения о лице, принявшем товар (получившем груз) (в том числе на ответственное хранение)</div>
  <div class="form-line"><span class="line-value">${blank(inspection.acceptedBy?.fio)}</span><span class="line-value">${blank(inspection.acceptedBy?.position)}</span><span class="line-value">${blank(inspection.acceptedBy?.basis)}</span></div>
  <div class="form-line" style="margin-top:0"><span class="line-value caption" style="border:none">фамилия, имя, отчество</span><span class="line-value caption" style="border:none">должность</span><span class="line-value caption" style="border:none">основание полномочий (доверие)</span></div>
  ${inspection.acceptedBy ? `<div class="small muted">${e(inspection.acceptedBy.role)}</div>` : ''}
  ${inspection.acceptedBy?.organization ? line('Уполномоченная организация', e(inspection.acceptedBy.organization)) : ''}
  ${inspection.acceptedBy?.organization && inspection.acceptedBy?.other ? line('На основании', e(inspection.acceptedBy.other)) : ''}
  ${!inspection.acceptedBy?.organization && inspection.acceptedBy?.other ? line('Иные сведения', e(inspection.acceptedBy.other)) : ''}
  <div class="section-space">По сопроводительным транспортным документам значится:</div>
  <table class="grid transport section-space">
    <thead><tr><th rowspan="2">Отметка об опломбировании товара (груза), состояние пломб и содержание оттиска</th><th rowspan="2">Количество мест</th><th rowspan="2">Вид упаковки</th><th rowspan="2">Наименование товара (груза) или номера вагонов (контейнеров, автофургонов и т.д.)</th><th colspan="2">Единица измерения</th><th colspan="2">Масса товара (груза) брутто</th><th colspan="2">Масса товара (груза) нетто</th><th rowspan="2">Особые отметки отправителя по накладной</th></tr>
    <tr><th>наименование</th><th>код по<br>ОКЕИ</th><th>в пункте отправления (по документам)</th><th>в пункте прибытия (факт)</th><th>в пункте отправления (по документам)</th><th>в пункте прибытия (факт)</th></tr>
    <tr class="numbers"><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td><td>9</td><td>10</td><td>11</td></tr></thead>
    <tbody>${transportRows || '<tr class="data-row"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'}</tbody>
  </table>
  ${line('Сведения о состоянии вагонов, автофургонов и т.д. Наличие, описание установленных ярлыков, пломб транспорта на отдельных местах (сертификатов, спецификаций в вагоне, контейнере) фактически')}
</section>

<section class="goods-section">
  <div class="page-label">2-я страница формы № ТОРГ-2</div>
  <table class="grid goods">
    <colgroup>
      <col style="width:14.99pt"><col style="width:224.11pt"><col style="width:30.73pt"><col style="width:26.24pt">
      <col style="width:35.23pt"><col style="width:23.23pt"><col style="width:24.74pt"><col style="width:63.71pt"><col style="width:35.23pt">
      <col style="width:32.23pt"><col style="width:25.48pt"><col style="width:34.48pt"><col style="width:29.23pt"><col style="width:29.98pt">
      <col style="width:32.23pt"><col style="width:25.49pt"><col style="width:29.98pt"><col style="width:29.23pt"><col style="width:27.73pt">
      <col style="width:38.98pt">
    </colgroup>
    <thead><tr><th rowspan="2">№<br>п/п</th><th rowspan="2">Товар<br>(наименование)</th><th colspan="2">Единица<br>измерения</th><th rowspan="2">Артикул<br>товара</th><th rowspan="2">Сорт</th><th rowspan="2">Код<br>товара</th><th rowspan="2">Характеристика</th><th rowspan="2">Номер<br>строки<br>сопроводительного<br>документа</th><th colspan="5">По документам поставщика значится</th><th colspan="5">Фактически оказалось</th><th rowspan="2">Номер<br>паспорта</th></tr>
    <tr><th>наименование</th><th>код по<br>ОКЕИ</th><th class="qty">количество<br>(масса)</th><th>цена,<br>руб. коп.</th><th>сумма,<br>руб. коп.</th><th>ставка<br>НДС</th><th>сумма<br>НДС</th><th class="qty">количество<br>(масса)</th><th>цена,<br>руб. коп.</th><th>сумма,<br>руб. коп.</th><th>ставка<br>НДС</th><th>сумма<br>НДС</th></tr>
    <tr class="numbers">${Array.from({ length: 20 }, (_, index) => `<td>${index + 1}</td>`).join('')}</tr></thead>
    <tbody>${goodsRows || '<tr class="data-row"><td colspan="20"></td></tr>'}</tbody>
  </table>
  <table class="grid discrepancies section-space">
    <colgroup>
      <col style="width:14.99pt"><col style="width:251.85pt">
      <col style="width:32.23pt"><col style="width:32.23pt"><col style="width:27.73pt"><col style="width:44.22pt">
      <col style="width:32.23pt"><col style="width:30.73pt"><col style="width:27.74pt"><col style="width:44.22pt">
      <col style="width:32.23pt"><col style="width:34.48pt"><col style="width:29.98pt"><col style="width:44.22pt">
      <col style="width:32.23pt"><col style="width:29.98pt"><col style="width:27.74pt"><col style="width:44.22pt">
    </colgroup>
    <thead>
      <tr>
        <th rowspan="3">№<br>п/п</th><th rowspan="3">Товар<br>(наименование)</th>
        <th colspan="4">Брак</th><th colspan="4">Бой</th><th colspan="8">Отклонения</th>
      </tr>
      <tr>
        <th rowspan="2">кол-во<br>(масса)</th><th rowspan="2">сумма,<br>руб. коп.</th><th rowspan="2">сумма<br>НДС</th><th rowspan="2">пояснение</th>
        <th rowspan="2">кол-во<br>(масса)</th><th rowspan="2">сумма,<br>руб. коп.</th><th rowspan="2">сумма<br>НДС</th><th rowspan="2">пояснение</th>
        <th colspan="4">Недостача</th><th colspan="4">Излишки</th>
      </tr>
      <tr>
        <th>количество<br>(масса)</th><th>сумма,<br>руб. коп.</th><th>сумма<br>НДС</th><th>пояснение</th>
        <th>количество<br>(масса)</th><th>сумма,<br>руб. коп.</th><th>сумма<br>НДС</th><th>пояснение</th>
      </tr>
      <tr class="numbers">${Array.from({ length: 18 }, (_, index) => `<td>${index + 1}</td>`).join('')}</tr>
    </thead>
    <tbody>${discrepancyRows || '<tr class="data-row"><td colspan="18"></td></tr>'}</tbody>
  </table>
  <div class="conditions-block">
  <div class="section-space">Условия хранения товара (продукции) до его вскрытия на складе получателя:</div>
  <div class="underlined">${blank(inspection.storageConditions)}</div>
  <div class="section-space">Сведения о температуре при разгрузке в вагоне (рефрижераторе и т. д.) в товаре, °C</div>
  <div class="underlined"></div>
  <div>Состояние тары и упаковки, маркировка мест, товара и тары в момент внешнего осмотра товара (продукции)</div>
  <div class="underlined">${blank(inspection.packagingState)}</div>
  <div>Содержание наружной маркировки тары и другие данные, на основании которых можно сделать выводы о том, в чьей упаковке предъявлен товар (производителя или отправителя)</div>
  <div class="underlined"></div>
  ${line('Дата вскрытия тары', blank(openingDate?.split(/\s+/)[0]))}
  <div>Организация, которая взвесила и опломбировала отправленный товар, исправность пломб и содержание оттисков, соответствие пломб товаросопроводительным документам</div>
  <div class="underlined"></div>
  <div>Порядок отбора товара (продукции) для выборочной проверки с указанием ГОСТ, особых условий поставки по договору (контракту), основание выборочной проверки</div>  </div>

  <div class="underlined"></div>
</section>

<section class="signatures-section">
  <div class="page-label">3-я страница формы № ТОРГ-2</div>
  ${line('Определение количества товара (продукции) проводилось', blank(inspection.shortageMethod))}
  <div class="caption">(взвешиванием, счетом мест, обмером и т. п.,<br>место определения количества товара (продукции))</div>
  <div class="underlined section-space"></div>
  <div class="section-space">Взвешивание товаров (продукции) проводилось на исправных весах, проверенных в установленном порядке. Сведение об исправности весоизмерительных приборов (тип весов, год клеймения)</div>
  <div class="underlined"></div>
  ${line('Другие данные', blank(inspection.otherInfo))}
  <div class="underlined"></div>
  <div class="section-space">По остальным товарно-материальным ценностям, перечисленным в сопроводительных документах поставщика, расхождений в количестве и качестве нет.</div>
  <div class="section-space">Подробное описание дефектов (характер недостачи, излишков, ненадлежащего качества, брака, боя)<br>и мнение комиссии о причинах их образования</div>
  <div class="text-block"></div>
  <div class="section-space"><strong>Заключение комиссии</strong></div>
  <div class="text-block">${e(conclusion || model.event.description || '')}</div>
  <div class="section-space">Члены комиссии предупреждены об ответственности за подписание акта, содержащего данные, не соответствующие действительности.</div>
  <table class="signature-grid"><tr><td class="label">Председатель комиссии</td><td></td><td></td><td></td></tr></table>
  <table class="signature-captions"><tr><td>(место работы, должность)</td><td>(подпись)</td><td>(расшифровка подписи)</td></tr></table>
  <div>Члены комиссии:</div>
  ${Array.from({ length: 3 }, () => '<table class="signature-grid"><tr><td class="label"></td><td></td><td></td><td></td></tr></table><table class="signature-captions"><tr><td>(место работы, должность)</td><td>(подпись)</td><td>(расшифровка подписи)</td></tr></table>').join('')}
  <div>Представитель грузоотправителя (поставщика, производителя)</div>
  <table class="signature-grid"><tr><td></td><td></td><td></td><td></td></tr></table>
  <table class="signature-captions"><tr><td>(место работы, должность)</td><td>(подпись)</td><td>(расшифровка подписи)</td></tr></table>
  ${line('Документ, удостоверяющий полномочия')}
  ${line('выдан')}
  ${line('№')}
  ${line('Акт с приложением на', blank(attachments))}
  ${line('Главный (старший) бухгалтер')}
  <div class="caption">(подпись) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (расшифровка подписи)</div>
  ${line('Решение руководителя')}
  ${!exact ? `<div class="disclaimer"><strong>Подписант по данным XML (не подтверждение подписи):</strong> ${e([signer?.fio, signer?.position, signer?.organization].filter(Boolean).join(', '))}.
    ${signer?.basis ? `Основание полномочий подписанта: ${e(signer.basis)}.` : ''}
    ${signer?.organizationBasis ? `Основание полномочий организации: ${e(signer.organizationBasis)}.` : ''}
    ${signer?.scopeCode ? `Область полномочий: ${e(decodedCode(SCOPE_LABELS, signer.scopeCode))}.` : ''}
    ${signer?.statusCode ? `Статус: ${e(decodedCode(STATUS_LABELS, signer.statusCode))}.` : ''}
    ${signer?.acknowledgment ? `Признак ознакомления: ${e(signer.acknowledgment)}.` : ''}
    ${signer?.other ? `${e(signer.other)}.` : ''}
    <strong style="white-space:nowrap">Подпись не проверялась.</strong> Сведения не подтверждают факт подписания; встроенной электронной подписи в PDF нет.</div>` : ''}
  ${!exact ? `<div class="meta-note">Документ ${e(meta.actName)}. КНД ${e(meta.knd)}. Сформирован ${e([meta.formedDate, meta.formedTime].filter(Boolean).join(' '))}. ${e(meta.additionalInfoCodes.join('; '))} ${e(meta.additionalInfoPurpose)} ${e(meta.organizationBasis)} ${e(meta.documentCircumstances)} ${basis.gosContractId ? `Госконтракт: ${e(basis.gosContractId)}.` : ''} ${basis.operationCode ? `Код обстоятельств: ${e(basis.operationCode)}.` : ''} ${e(inspection.info.map((item) => `${item.id}: ${item.value}`).join('; '))}</div>` : ''}
</section>
${longCharacteristicHtml}
${extraHtml}
${appendixHtml}
</body>
</html>`;
}
