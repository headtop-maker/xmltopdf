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

export interface Torg2TemplateOptions {
  readonly fontCss: string;
}

export function renderTorg2Html(model: Torg2PrintModel, options: Torg2TemplateOptions): string {
  const { meta, parties, basis, inspection, rows } = model;
  const [inspectionDay, inspectionMonth, inspectionYear] = dateParts(inspection.date);
  const accompanying = inspection.accompanyingDocuments
    .map((doc) => `${doc.name ?? ''}, ${doc.number ?? ''}, ${doc.date ?? ''}`)
    .join('; ');
  const eventInfo = model.event.info
    .map((item) => (item.id ? `${item.id}: ${item.value}` : item.value))
    .join('; ');
  const eventDescription = [model.event.description, eventInfo].filter(Boolean).join('; ');
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
  const longCharacteristicHtml = longCharacteristics.length
    ? `<section class="appendix"><h2>Характеристики товарных строк</h2><table class="grid">
<thead><tr><th>№</th><th>Товар</th><th>Характеристика</th></tr></thead><tbody>
${longCharacteristics.map((row) => `<tr><td class="center">${row.number}</td><td>${e(row.name)}</td><td>${e(row.characteristic)}</td></tr>`).join('')}
</tbody></table></section>`
    : '';
  const extraHtml = extraRows.length
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
  const appendixHtml = model.appendix.length
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
@page { size: A4 landscape; margin: 6mm 5mm 12mm 5mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'PT Sans', 'DejaVu Sans', sans-serif; font-size: 8.2pt; line-height: 1.22; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.form-page { break-after: page; }
.goods-section { break-before: page; }
.conditions-block { break-inside: avoid; }
.signatures-section { break-inside: avoid; }
.text-block { border-bottom: 0.6pt solid #111; padding: 1mm 0; min-height: 4mm; white-space: pre-wrap; }
.section-space { break-inside: avoid; }
.form-page:last-child { break-after: auto; }
.center { text-align: center; }
.num { text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; }
.small { font-size: 6.8pt; }
.muted { color: #444; }
.source-id { width: 66%; font-size: 7.6pt; overflow-wrap: anywhere; }
.underlined { border-bottom: 0.6pt solid #111; min-height: 3.3mm; }
.caption { text-align: center; font-size: 6.2pt; }
.party-line { margin: 1.1mm 0 0; }
.party-line .label { font-weight: bold; }
.party-line .underlined { padding: 0 1mm; }
.title-block { display: grid; grid-template-columns: 1fr 61mm; gap: 5mm; align-items: center; margin: 4mm 0 2mm; }
h1 { font-size: 11pt; line-height: 1.25; text-align: center; text-transform: uppercase; margin: 0; }
.document-number { border-collapse: collapse; width: 61mm; }
.document-number td { border: 0.7pt solid #111; padding: 1.1mm; text-align: center; }
.document-number .head { font-size: 7.2pt; }
.form-line { display: flex; align-items: flex-end; gap: 1.5mm; margin-top: 1.4mm; min-height: 3.5mm; }
.line-value { flex: 1; border-bottom: 0.6pt solid #111; padding: 0 1mm; min-height: 3.3mm; }
.line-value.empty { min-width: 35mm; }
.commission-date { display: flex; align-items: flex-end; gap: 1mm; }
.commission-date .label { margin-right: 2mm; }
.date-cell { width: 17mm; text-align: center; border-bottom: 0.6pt solid #111; }
.date-cell.year { width: 23mm; }
table { border-collapse: collapse; width: 100%; }
.grid th, .grid td { border: 0.55pt solid #111; padding: 0.7mm 0.8mm; vertical-align: middle; }
.grid th { text-align: center; font-weight: normal; font-size: 6.9pt; line-height: 1.15; overflow-wrap: break-word; }
.grid thead { display: table-header-group; }
.grid tbody tr { break-inside: avoid; }
.grid .numbers td { text-align: center; font-size: 6.6pt; }
.grid .data-row td { font-size: 8pt; }
.section-space { margin-top: 1.8mm; }
.page-label { text-align: right; margin-bottom: 4mm; }
.goods { table-layout: fixed; }
.goods th { font-size: 6.4pt; padding: 0.5mm; line-height: 1.12; }
.goods th.qty { font-size: 6pt; }
.goods .data-row td { padding: 0.7mm 0.7mm; font-size: 8pt; line-height: 1.2; overflow-wrap: break-word; }
.discrepancies { table-layout: fixed; }
.discrepancies th { font-size: 6.3pt; padding: 0.5mm; line-height: 1.12; }
.discrepancies .data-row td { padding: 0.7mm 0.7mm; font-size: 8pt; line-height: 1.2; overflow-wrap: break-word; }
.timeline td, .timeline th { height: 9mm; }
.transport th { font-size: 6.6pt; }
.transport .numbers td { height: 4mm; }
.signature-grid td { border: none; border-bottom: 0.55pt solid #111; height: 6mm; }
.signature-grid .label { border-bottom: none; width: 32mm; }
.signature-captions td { border: none; text-align: center; font-size: 6.3pt; padding: 0 1mm 2mm; }
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
  <div class="party-line"><div class="underlined"><span class="label">${partyText(parties.buyer)}</span></div><div class="caption">(организация, адрес, номер телефона)</div></div>
  <div class="party-line"><div class="underlined">${partyText(parties.consignee)}</div><div class="caption">(структурное подразделение)</div></div>
  <div class="party-line"><span>Основание составления акта:</span><div class="underlined" style="margin-left:2mm;width:50%">${e(order)}</div><div class="caption" style="margin-left:2mm">(ненужное зачеркнуть)</div></div>
  <div class="title-block">
    <h1>Акт об установленном расхождении по количеству и качеству<br>при приемке товарно-материальных ценностей</h1>
    <table class="document-number">
      <tr class="head"><td>Номер<br>документа</td><td>Дата<br>составления</td></tr>
      <tr><td>${e(meta.documentNumber)}</td><td>${e(meta.documentDate)}</td></tr>
      <tr><td colspan="2" style="border-bottom:none;padding-bottom:0">Исправление</td></tr>
      <tr><td>${blank(meta.correctionNumber)}</td><td>${blank(meta.correctionDate)}</td></tr>
    </table>
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
  ${line('Грузоотправитель', partyText(parties.shipper))}
  <div class="caption">(наименование, адрес, номер телефона)</div>
  ${line('Производитель')}
  <div class="caption">(наименование, адрес, номер телефона)</div>
  ${line('Поставщик', partyText(parties.seller))}
  <div class="caption">(наименование, адрес, номер телефона)</div>
  ${line('Страховая компания', partyText(parties.insurer))}
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
  ${inspection.acceptedBy ? `<div class="small muted">${e(inspection.acceptedBy.role)}${inspection.acceptedBy.other ? `; ${e(inspection.acceptedBy.other)}` : ''}</div>` : ''}
  <div class="section-space">По сопроводительным транспортным документам значится:</div>
  <table class="grid transport section-space">
    <thead><tr><th rowspan="2">Отметка об опломбировании товара (груза), состояние пломб и содержание оттиска</th><th rowspan="2">Количество мест</th><th rowspan="2">Вид упаковки</th><th rowspan="2">Наименование товара (груза) или номера вагонов (контейнеров, автофургонов и т.д.)</th><th colspan="2">Единица измерения</th><th colspan="2">Масса товара (груза) брутто</th><th colspan="2">Масса товара (груза) нетто</th><th rowspan="2">Особые отметки отправителя по накладной</th></tr>
    <tr><th>наимено-<br>вание</th><th>код по<br>ОКЕИ</th><th>в пункте отправления (по документам)</th><th>в пункте прибытия (факт)</th><th>в пункте отправления (по документам)</th><th>в пункте прибытия (факт)</th></tr>
    <tr class="numbers"><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td><td>9</td><td>10</td><td>11</td></tr></thead>
    <tbody>${transportRows || '<tr class="data-row"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'}</tbody>
  </table>
  ${line('Сведения о состоянии вагонов, автофургонов и т.д. Наличие, описание установленных ярлыков, пломб транспорта на отдельных местах (сертификатов, спецификаций в вагоне, контейнере) фактически')}
</section>

<section class="goods-section">
  <table class="grid goods">
    <colgroup>
      <col style="width:7mm"><col style="width:45mm"><col style="width:12mm"><col style="width:8mm">
      <col style="width:10mm"><col style="width:7mm"><col style="width:10mm"><col style="width:17mm"><col style="width:10mm">
      <col style="width:13mm"><col style="width:14mm"><col style="width:16mm"><col style="width:9mm"><col style="width:13mm">
      <col style="width:13mm"><col style="width:14mm"><col style="width:16mm"><col style="width:9mm"><col style="width:13mm">
      <col style="width:11mm">
    </colgroup>
    <thead><tr><th rowspan="2">№<br>п/п</th><th rowspan="2">Товар<br>(наименование)</th><th colspan="2">Единица<br>измерения</th><th rowspan="2">Артикул<br>товара</th><th rowspan="2">Сорт</th><th rowspan="2">Код<br>товара</th><th rowspan="2">Характеристика</th><th rowspan="2">№ строки<br>сопров. док.</th><th colspan="5">По документам поставщика значится</th><th colspan="5">Фактически оказалось</th><th rowspan="2">Номер<br>паспорта</th></tr>
    <tr><th>наимено-<br>вание</th><th>код по<br>ОКЕИ</th><th class="qty">кол-во<br>(масса)</th><th>цена,<br>руб. коп.</th><th>сумма,<br>руб. коп.</th><th>ставка<br>НДС</th><th>сумма<br>НДС</th><th class="qty">кол-во<br>(масса)</th><th>цена,<br>руб. коп.</th><th>сумма,<br>руб. коп.</th><th>ставка<br>НДС</th><th>сумма<br>НДС</th></tr>
    <tr class="numbers">${Array.from({ length: 20 }, (_, index) => `<td>${index + 1}</td>`).join('')}</tr></thead>
    <tbody>${goodsRows || '<tr class="data-row"><td colspan="20"></td></tr>'}</tbody>
  </table>
  <table class="grid discrepancies section-space">
    <colgroup>
      <col style="width:7mm"><col style="width:40mm">
      <col style="width:12mm"><col style="width:15mm"><col style="width:13mm"><col style="width:14mm">
      <col style="width:12mm"><col style="width:15mm"><col style="width:13mm"><col style="width:14mm">
      <col style="width:12mm"><col style="width:15mm"><col style="width:13mm"><col style="width:14mm">
      <col style="width:12mm"><col style="width:15mm"><col style="width:13mm"><col style="width:14mm">
    </colgroup>
    <thead>
      <tr>
        <th rowspan="4">№<br>п/п</th><th rowspan="4">Товар<br>(наименование)</th>
        <th colspan="4">Брак</th><th colspan="4">Бой</th><th colspan="8">Отклонения</th>
      </tr>
      <tr>
        <th rowspan="2">кол-во<br>(масса)</th><th rowspan="2">сумма,<br>руб. коп.</th><th rowspan="2">сумма<br>НДС</th><th rowspan="2">пояснение</th>
        <th rowspan="2">кол-во<br>(масса)</th><th rowspan="2">сумма,<br>руб. коп.</th><th rowspan="2">сумма<br>НДС</th><th rowspan="2">пояснение</th>
        <th colspan="4">Недостача</th><th colspan="4">Излишки</th>
      </tr>
      <tr>
        <th>кол-во<br>(масса)</th><th>сумма,<br>руб. коп.</th><th>сумма<br>НДС</th><th>пояснение</th>
        <th>кол-во<br>(масса)</th><th>сумма,<br>руб. коп.</th><th>сумма<br>НДС</th><th>пояснение</th>
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
  ${line('Определение количества товара (продукции) проводилось', blank(inspection.shortageMethod))}
  <div class="caption">(взвешиванием, счетом мест, обмером и т. п.,<br>место определения количества товара (продукции))</div>
  <div class="underlined section-space"></div>
  <div class="section-space">Взвешивание товаров (продукции) проводилось на исправных весах, проверенных в установленном порядке. Сведение об исправности весоизмерительных приборов (тип весов, год клеймения)</div>
  <div class="underlined"></div>
  ${line('Другие данные', blank(inspection.otherInfo))}
  <div class="underlined"></div>
  <div class="section-space">По остальным товарно-материальным ценностям, перечисленным в сопроводительных документах поставщика, расхождений в количестве и качестве нет.</div>
  ${model.event.operationType ? `<div class="section-space"><strong>Вид операции:</strong> ${e(model.event.operationType)}</div>` : ''}
  <div class="section-space"><strong>Описание события и расхождений</strong></div>
  <div class="text-block">${eventDescription ? e(eventDescription) : ''}</div>
  ${
    conclusion
      ? `<div class="section-space"><strong>Заключение комиссии</strong></div><div class="text-block">${e(conclusion)}</div>`
      : ''
  }
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
  <div class="disclaimer"><strong>Подписант по данным XML (не подтверждение подписи):</strong> ${e([signer?.fio, signer?.position, signer?.organization].filter(Boolean).join(', '))}.
    ${signer?.basis ? `Основание полномочий подписанта: ${e(signer.basis)}.` : ''}
    ${signer?.organizationBasis ? `Основание полномочий организации: ${e(signer.organizationBasis)}.` : ''}
    ${signer?.statusCode || signer?.scopeCode ? `Коды формата: статус ${e(signer?.statusCode)}, область полномочий ${e(signer?.scopeCode)}.` : ''}
    ${signer?.acknowledgment ? `Признак ознакомления: ${e(signer.acknowledgment)}.` : ''}
    ${signer?.other ? `${e(signer.other)}.` : ''}
    <strong style="white-space:nowrap">Подпись не проверялась.</strong> Сведения не подтверждают факт подписания; встроенной электронной подписи в PDF нет.</div>
  <div class="meta-note">Документ ${e(meta.actName)}. КНД ${e(meta.knd)}. Сформирован ${e([meta.formedDate, meta.formedTime].filter(Boolean).join(' '))}. ${e(meta.additionalInfoCodes.join('; '))} ${e(meta.additionalInfoPurpose)} ${e(meta.organizationBasis)} ${e(meta.documentCircumstances)} ${basis.gosContractId ? `Госконтракт: ${e(basis.gosContractId)}.` : ''} ${basis.operationCode ? `Код обстоятельств: ${e(basis.operationCode)}.` : ''} ${e(inspection.info.map((item) => `${item.id}: ${item.value}`).join('; '))}</div>
</section>
${longCharacteristicHtml}
${extraHtml}
${appendixHtml}
</body>
</html>`;
}
