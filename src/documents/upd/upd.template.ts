import { escapeHtml, formatMoney, formatQuantity, formatRate } from '../shared/format';
import { formatPartyForPrint } from '../shared/party-print';
import type { PartyModel } from '../shared/party';
import type { DocumentRef, KeyValue } from '../torg2/torg2.model';
import type { UpdPrintModel, UpdRow } from './upd.model';

const e = (value: string | undefined | null): string => escapeHtml(value ?? '');
const dash = (value: string | undefined): string => (value && value.trim() !== '' ? e(value) : '—');

function money(value: string | undefined): string {
  return formatMoney(value) ? e(formatMoney(value)) : '—';
}

function qty(value: string | undefined): string {
  return formatQuantity(value) ? e(formatQuantity(value)) : '—';
}

function partyCard(party: PartyModel | undefined, label: string): string {
  if (!party) return '';
  const info = formatPartyForPrint(party);
  return `<div class="party"><div class="party-label">${e(label)}</div>
    <div class="party-name">${e(info.title)}</div>
    ${info.lines.map((line) => `<div class="party-line">${e(line)}</div>`).join('')}
  </div>`;
}

function docRefText(doc: DocumentRef): string {
  return [
    dash(doc.kind),
    doc.number ? `№ ${e(doc.number)}` : undefined,
    doc.date ? `от ${e(doc.date)}` : undefined,
    doc.additionalId ? `(${e(doc.additionalId)})` : undefined,
  ]
    .filter(Boolean)
    .join(' ');
}

function docList(docs: readonly DocumentRef[]): string {
  if (docs.length === 0) return '—';
  return docs.map((doc) => docRefText(doc)).join('<br>');
}

function infoRows(items: readonly KeyValue[]): string {
  return items
    .filter((item) => item.id || item.value)
    .map((item) => `<tr><th>${dash(item.id)}</th><td>${dash(item.value)}</td></tr>`)
    .join('');
}

function rowDetails(row: UpdRow): string {
  const parts: string[] = [];
  if (row.extra?.characteristic) parts.push(`Характеристика: ${row.extra.characteristic}`);
  if (row.extra?.article) parts.push(`Артикул: ${row.extra.article}`);
  if (row.extra?.code) parts.push(`Код товара: ${row.extra.code}`);
  if (row.extra?.gtin) parts.push(`ГТИН: ${row.extra.gtin}`);
  if (row.extra?.okpd2) parts.push(`ОКПД2: ${row.extra.okpd2}`);
  if (row.extra?.sort) parts.push(`Сорт: ${row.extra.sort}`);
  if (row.extra?.series) parts.push(`Серия: ${row.extra.series}`);
  if (row.extra?.orderedQuantity) parts.push(`Надлежит отпустить: ${row.extra.orderedQuantity}`);
  for (const trace of row.traceability) {
    parts.push(
      `Прослеживаемость: партия ${trace.batchNumber ?? '—'}, ${trace.quantity ?? '—'} ${trace.unitName ?? trace.unitCode ?? ''}`.trim(),
    );
  }
  if (row.marking.kiz.length) parts.push(`КИЗ: ${row.marking.kiz.join(', ')}`);
  if (row.marking.packaging.length) parts.push(`Упаковка: ${row.marking.packaging.join(', ')}`);
  if (row.marking.transportPackaging) parts.push(`Транспортная упаковка: ${row.marking.transportPackaging}`);
  for (const doc of row.accessoryDocuments) parts.push(`Документ по товару: ${docRefText(doc).replace(/<[^>]+>/g, '')}`);
  for (const item of row.info) parts.push(`${item.id}: ${item.value}`);
  return parts
    .filter((part) => part.trim() !== '')
    .map((part) => `<div class="small muted">${e(part)}</div>`)
    .join('');
}

export interface UpdTemplateOptions {
  readonly fontCss: string;
}

export function renderUpdHtml(model: UpdPrintModel, options: UpdTemplateOptions): string {
  const { meta, parties, invoice, rows, totals, transfer } = model;

  const isCommission = meta.function === 'СвРК' || meta.function === 'СвЗК';
  const isShipmentDocument = meta.function === 'ДОП' || isCommission;
  const title =
    meta.function === 'СЧФ'
      ? 'Счёт-фактура'
      : meta.function === 'ДОП'
        ? 'Документ об отгрузке товаров (выполнении работ), передаче имущественных прав'
        : meta.function === 'СвРК'
          ? 'Сведения о факте реализации комиссионером (агентом) товаров комитента (принципала)'
          : meta.function === 'СвЗК'
            ? 'Сведения о факте закупки комиссионером (агентом) товаров для комитента (принципала)'
            : 'Универсальный передаточный документ';

  const rawDescription = meta.subjectDescription?.trim();
  const description =
    rawDescription &&
    !rawDescription.toLowerCase().includes(title.toLowerCase()) &&
    !title.toLowerCase().includes(rawDescription.toLowerCase())
      ? rawDescription
      : undefined;

  const functionCaption =
    meta.function === 'СЧФ'
      ? 'Функция СЧФ · печатается как счёт-фактура'
      : meta.function === 'ДОП'
        ? 'Функция ДОП · печатается как документ об отгрузке, счёт-фактура не формируется'
        : meta.function === 'СвРК'
          ? 'Функция СвРК · сведения о реализации посредником товаров комитента; это не счёт-фактура'
          : meta.function === 'СвЗК'
            ? 'Функция СвЗК · сведения о закупке посредником товаров для комитента; это не счёт-фактура'
            : 'Функция СЧФДОП · счёт-фактура и документ об отгрузке';

  const sellers = parties.sellers.length
    ? parties.sellers.map((party, index) => partyCard(party, parties.sellers.length > 1 ? `Продавец ${index + 1}` : 'Продавец (поставщик, исполнитель)')).join('')
    : '<div class="party"><div class="party-label">Продавец</div><div class="party-value muted">не указано в XML</div></div>';

  const buyers = parties.buyers.length
    ? parties.buyers.map((party, index) => partyCard(party, parties.buyers.length > 1 ? `Покупатель ${index + 1}` : 'Покупатель (заказчик)')).join('')
    : '';

  const shippers = parties.shipperSameAsSeller
    ? `<div class="party"><div class="party-label">Грузоотправитель</div><div class="party-value">он же (продавец)</div></div>`
    : parties.shippers.map((party) => partyCard(party, 'Грузоотправитель')).join('');

  const consignees = parties.consignees
    .map((party) => partyCard(party, 'Грузополучатель'))
    .join('');

  const goodsRows = rows
    .map(
      (row) => `<tr>
  <td class="center">${e(row.number)}</td>
  <td><div class="goods-name">${dash(row.name)}</div>${rowDetails(row)}</td>
  <td class="center">${dash(row.extra?.productTypeCode)}</td>
  <td class="center">${dash(row.unitName)}${row.unitCode ? `<div class="small muted">ОКЕИ ${e(row.unitCode)}</div>` : ''}</td>
  <td class="num">${qty(row.quantity)}</td>
  <td class="num">${money(row.price)}</td>
  <td class="num">${money(row.amountWithoutVat)}</td>
  <td class="num">${row.exciseNone ? 'без акциза' : money(row.exciseAmount)}</td>
  <td class="center">${row.vatNone ? 'без НДС' : dash(formatRate(row.vatRate))}</td>
  <td class="num">${row.vatNone ? '—' : money(row.vatAmount)}</td>
  <td class="num">${money(row.amountWithVat)}</td>
  <td class="center">${row.countryNames.length ? row.countryNames.map((name) => e(name)).join('<br>') : dash(row.countryCode)}</td>
  <td class="center small">${row.customsNumbers.length ? row.customsNumbers.map((number) => e(number)).join('<br>') : '—'}</td>
</tr>`,
    )
    .join('\n');

  const transferBlock = transfer
    ? `<section class="avoid">
  <h2>Сведения о передаче (отгрузке) товаров, результатов работ, имущественных прав</h2>
  <table class="plain">
    <tr><th>Содержание операции</th><td>${dash(transfer.operationContent)}</td><th>Вид операции</th><td>${dash(transfer.operationType)}</td></tr>
    <tr><th>Дата передачи</th><td>${dash(transfer.date)}</td><th>Период оказания услуг</th><td>${transfer.periodStart || transfer.periodEnd ? `${dash(transfer.periodStart)} — ${dash(transfer.periodEnd)}` : '—'}</td></tr>
    <tr><th>Основание передачи</th><td colspan="3">${transfer.bases.length ? transfer.bases.map((doc) => docRefText(doc)).join('<br>') : '—'}${transfer.withoutBasisDocument ? '<div class="small muted">Без документа-основания отгрузки</div>' : ''}</td></tr>
    ${
      transfer.person
        ? `<tr><th>Товар передал</th><td colspan="3">${dash(transfer.person.fio)}${transfer.person.position ? `, ${e(transfer.person.position)}` : ''}${transfer.person.organization ? `, ${e(transfer.person.organization)}` : ''}${transfer.person.basis ? `<div class="small muted">Основание: ${e(transfer.person.basis)}</div>` : ''}${transfer.person.other ? `<div class="small muted">${e(transfer.person.other)}</div>` : ''}<div class="small muted">${e(transfer.person.role)}</div></td></tr>`
        : ''
    }
    ${
      transfer.transport
        ? `<tr><th>Транспортировка</th><td colspan="3">${dash(transfer.transport.description)}${transfer.transport.incoterms ? ` · Инкотермс ${e(transfer.transport.incoterms)}${transfer.transport.incotermsVersion ? ` (${e(transfer.transport.incotermsVersion)})` : ''}` : ''}</td></tr>`
        : ''
    }
    ${
      transfer.thingTransfer
        ? `<tr><th>Передача вещи по подряду</th><td colspan="3">${dash(transfer.thingTransfer.date)}${transfer.thingTransfer.description ? ` · ${e(transfer.thingTransfer.description)}` : ''}${transfer.thingTransfer.document ? `<div class="small muted">${docRefText(transfer.thingTransfer.document)}</div>` : ''}</td></tr>`
        : ''
    }
    ${infoRows(transfer.info)}
  </table>
</section>`
    : '';

  const signersRows = model.signers
    .map(
      (signer, index) => `<tr>
        <td class="center">${index + 1}</td>
        <td>${signer.fio ? e(signer.fio) : '<span class="muted">не указано в XML</span>'}</td>
        <td>${dash(signer.position)}</td>
        <td class="center">${dash(signer.signatureType)}</td>
        <td class="center">${dash(signer.authorityMethod)}</td>
        <td>${signer.powersOfAttorney.length ? signer.powersOfAttorney.map((item) => e(item)).join('<br>') : '—'}</td>
        <td class="center">${dash(signer.signedDate)}</td>
      </tr>`,
    )
    .join('\n');

  const appendixHtml = model.appendix.length
    ? `<section class="appendix">
  <h2>Приложение. Реквизиты исходного XML, не вошедшие в основной бланк</h2>
  <p class="small muted">Приложение является частью этого же PDF. Значения приведены без изменения, в порядке следования в XML.${meta.sourceId ? ` Идентификатор файла: ${e(meta.sourceId)}.` : ''} Источник XML: SHA-256 ${e(meta.sourceSha256)}.</p>
  ${model.appendix
    .map(
      (group) => `<div class="appendix-group">
      <h3>${e(group.title)}</h3>
      <table class="grid appendix-table">
        <thead><tr><th class="idx">№</th><th>Реквизит</th><th>Значение</th></tr></thead>
        <tbody>
          ${group.rows
            .map(
              (row, index) => `<tr>
            <td class="center">${index + 1}</td>
            <td><div>${e(row.label)}</div><div class="small muted mono">${e(row.path)}</div></td>
            <td class="value">${e(row.value)}</td>
          </tr>`,
            )
            .join('\n')}
        </tbody>
      </table>
    </div>`,
    )
    .join('\n')}
</section>`
    : '';

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>УПД ${e(meta.number)} от ${e(meta.date)}</title>
<style>
${options.fontCss}
@page { size: A4 landscape; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'PT Sans', 'DejaVu Sans', sans-serif;
  font-size: 9pt; line-height: 1.3; color: #14171a;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h2 { font-size: 10pt; margin: 4mm 0 1.6mm 0; text-transform: uppercase; letter-spacing: 0.02em; border-bottom: 0.6pt solid #9aa4ae; padding-bottom: 1mm; }
h3 { font-size: 9.2pt; margin: 3mm 0 1.2mm 0; }
table { border-collapse: collapse; width: 100%; }
.grid th, .grid td { border: 0.5pt solid #5a636c; padding: 0.9mm 1.2mm; vertical-align: top; }
.grid thead th { background: #eef1f4; font-size: 7.2pt; text-align: center; font-weight: bold; }
.grid tbody td { font-size: 7.9pt; }
.plain th, .plain td { padding: 0.7mm 2mm 0.7mm 0; vertical-align: top; text-align: left; }
.plain th { width: 40mm; font-weight: normal; color: #3b434b; }
.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.center { text-align: center; }
.small { font-size: 7.1pt; line-height: 1.25; }
.muted { color: #5c656e; }
.mono { word-break: break-word; }
.avoid { break-inside: avoid; }
.doc-head { border: 0.8pt solid #2f363d; padding: 3mm 4mm; margin-bottom: 3mm; }
.org-name { font-size: 10.5pt; font-weight: bold; }
.org-line { font-size: 7.6pt; color: #5c656e; margin-bottom: 2mm; }
.doc-caption { text-align: center; font-size: 8pt; color: #5c656e; letter-spacing: 0.05em; }
h1 { font-size: 13pt; line-height: 1.25; margin: 1mm 0; text-align: center; }
.doc-description { text-align: center; font-size: 8.2pt; color: #3b434b; margin-bottom: 2mm; }
.metrics { display: grid; grid-template-columns: 1.15fr 1fr 1fr 0.8fr; margin-top: 2.5mm; border-top: 0.5pt solid #9aa4ae; }
.metric { padding: 1.1mm 2mm 1.1mm 0; border-right: 0.4pt solid #c4cad0; }
.metric:last-child { border-right: none; }
.metric-label { font-size: 6.9pt; text-transform: uppercase; letter-spacing: 0.04em; color: #5c656e; }
.metric-value { font-size: 9.3pt; font-weight: bold; margin-top: 0.3mm; word-break: break-word; }
.source-id { margin-top: 1.6mm; font-size: 6.8pt; color: #5c656e; word-break: break-all; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 4mm; }
.party { border-left: 2.2pt solid #2f363d; padding: 1.2mm 0 1.2mm 2.4mm; break-inside: avoid; }
.party-label { font-size: 7.1pt; text-transform: uppercase; letter-spacing: 0.05em; color: #5c656e; }
.party-name { font-size: 9pt; font-weight: bold; margin-top: 0.4mm; }
.party-line, .party-value { font-size: 7.8pt; }
.goods td { font-size: 7.6pt; }
.goods tbody tr { break-inside: avoid; }
.goods th { font-size: 6.9pt; }
.goods-name { font-weight: bold; }
.totals-row td { font-weight: bold; background: #f4f6f8; }
.commission-note { border-left: 2.5pt solid #8a6d1f; background: #fbf7ea; padding: 2mm 3mm; font-size: 8pt; margin-top: 2mm; }
.disclaimer { border: 0.6pt dashed #8a939c; padding: 2mm 2.5mm; font-size: 7.8pt; margin-top: 2.5mm; background: #fafbfc; }
.appendix { break-before: page; }
.appendix-table td.value { word-break: break-word; }
.appendix-table .idx { width: 10mm; }
.footer-note { margin-top: 3mm; font-size: 7pt; color: #5c656e; }
.goods-section { break-before: page; }
</style>
</head>
<body>

<header class="doc-head">
  <div class="org-name">${meta.organization ? e(meta.organization) : 'Экономический субъект не указан'}</div>
  <div class="org-line">Электронный документ · функция ${e(meta.function)}</div>
  <h1>${e(title)}</h1>
  <div class="doc-description">${e(description ?? (isCommission ? meta.functionLabel : functionCaption))}</div>
  <div class="metrics">
    <div class="metric"><div class="metric-label">${isShipmentDocument ? 'Номер документа' : 'Номер счёта-фактуры'}</div><div class="metric-value">${dash(meta.number)}</div></div>
    <div class="metric"><div class="metric-label">${isShipmentDocument ? 'Дата документа' : 'Дата составления'}</div><div class="metric-value">${dash(meta.date)}</div></div>
    <div class="metric"><div class="metric-label">Исправление</div><div class="metric-value">${meta.correctionNumber || meta.correctionDate ? `${dash(meta.correctionNumber)} от ${dash(meta.correctionDate)}` : '—'}</div></div>
    <div class="metric"><div class="metric-label">Функция</div><div class="metric-value">${e(meta.function)}</div></div>
    <div class="metric"><div class="metric-label">КНД</div><div class="metric-value">${e(meta.knd)}</div></div>
    <div class="metric"><div class="metric-label">Сформирован</div><div class="metric-value">${dash([meta.formedDate, meta.formedTime].filter(Boolean).join(' '))}</div></div>
    <div class="metric"><div class="metric-label">Валюта</div><div class="metric-value">${dash(meta.currency.name)} ${meta.currency.code ? `(${e(meta.currency.code)})` : ''}${meta.currency.rate ? `<div class="small muted">курс ${e(meta.currency.rate)}</div>` : ''}</div></div>
    <div class="metric"><div class="metric-label">Версия формата</div><div class="metric-value">${e(meta.formatVersion)}</div></div>
  </div>
  <div class="source-id">Идентификатор файла: <span class="mono">${dash(meta.sourceId)}</span>${meta.documentUid ? ` · УИД: <span class="mono">${e(meta.documentUid)}</span>` : ''}</div>
</header>

<section class="avoid">
  <h2>Стороны</h2>
  <div class="parties">
    ${sellers}
    ${buyers}
    ${shippers}
    ${consignees}
    ${parties.factor ? partyCard(parties.factor, 'Фактор') : ''}
  </div>
  ${
    isCommission
      ? `<div class="commission-note"><strong>Документ с функцией ${e(meta.function)}.</strong> Это не счёт-фактура и не УПД.
    Сведения о комитенте (принципале) печатаются только в том виде, в каком они переданы в XML
    (информационные поля и приложение). Конвертер не подставляет отсутствующие стороны и не формирует счёт-фактуру.</div>`
      : ''
  }
</section>

<section class="avoid">
  <h2>${isShipmentDocument ? 'Основание и реквизиты документа' : 'Платёжно-расчётные и отгрузочные документы'}</h2>
  <table class="plain">
    <tr><th>${isShipmentDocument ? 'Подтверждающие документы' : 'Документы об отгрузке'}</th><td colspan="3">${docList(invoice.shipmentDocuments)}</td></tr>
    <tr><th>Платёжно-расчётные документы</th><td colspan="3">${
      invoice.paymentDocuments.length
        ? invoice.paymentDocuments
            .map(
              (doc) =>
                `${dash(doc.number)}${doc.date ? ` от ${e(doc.date)}` : ''}${doc.amount ? `, сумма ${money(doc.amount)}` : ''}`,
            )
            .join('<br>')
        : '—'
    }</td></tr>
    ${invoice.gosContractId ? `<tr><th>Идентификатор госконтракта</th><td colspan="3">${e(invoice.gosContractId)}</td></tr>` : ''}
    ${invoice.correctedSellerFile ? `<tr><th>Исправляемый файл продавца</th><td colspan="3" class="mono small">${e(invoice.correctedSellerFile)}</td></tr>` : ''}
    ${invoice.correctedBuyerFile ? `<tr><th>Исправляемый файл покупателя</th><td colspan="3" class="mono small">${e(invoice.correctedBuyerFile)}</td></tr>` : ''}
    ${invoice.specialCircumstances.map((item) => `<tr><th>${e(item.id)}</th><td colspan="3">${dash(item.value)}</td></tr>`).join('')}
    ${invoice.obligationTypes.map((item) => `<tr><th>Вид обязательств ${e(item.id)}</th><td colspan="3">${dash(item.value)}</td></tr>`).join('')}
    ${invoice.authorityBasis ? `<tr><th>Основание полномочий составителя</th><td colspan="3">${docRefText(invoice.authorityBasis)}</td></tr>` : ''}
    ${infoRows(invoice.info)}
  </table>
</section>

<section class="goods-section">
  <h2>${isShipmentDocument ? 'Товары (работы, услуги), передаваемые по документу' : 'Сведения о товарах (работах, услугах)'}</h2>
  <table class="grid goods">
    <colgroup>
      <col style="width:8mm"><col><col style="width:14mm"><col style="width:20mm"><col style="width:14mm">
      <col style="width:16mm"><col style="width:18mm"><col style="width:14mm"><col style="width:11mm"><col style="width:16mm">
      <col style="width:18mm"><col style="width:16mm"><col style="width:18mm">
    </colgroup>
    <thead>
      <tr>
        <th>№</th><th>Наименование товара (работ, услуг)</th><th>Код вида товара</th><th>Ед. изм.</th>
        <th>Кол-во</th><th>Цена</th><th>Стоимость без налога</th><th>Акциз</th>
        <th>Ставка налога</th><th>Сумма налога</th><th>Стоимость с налогом</th>
        <th>Страна происхождения</th><th>Номер ГТД</th>
      </tr>
    </thead>
    <tbody>
      ${goodsRows || '<tr><td colspan="13" class="center muted">Товарная таблица в XML отсутствует</td></tr>'}
    </tbody>
    <tfoot>
      <tr class="totals-row">
        <td colspan="4">${isShipmentDocument ? 'Итого по документу' : 'Всего к оплате'}</td>
        <td class="num">${qty(totals.netQuantity)}</td><td></td>
        <td class="num">${money(totals.withoutVat)}</td><td></td><td></td>
        <td class="num">${money(totals.vat)}</td><td class="num">${money(totals.withVat)}</td><td colspan="2"></td>
      </tr>
    </tfoot>
  </table>
</section>

${transferBlock}

<section class="avoid">
  <h2>Сведения о подписантах (по данным XML)</h2>
  <table class="grid">
    <thead><tr><th style="width:8mm">№</th><th>Фамилия, имя, отчество</th><th>Должность</th><th>Тип подписи</th><th>Способ подтверждения полномочий</th><th>Доверенности</th><th>Дата подписания</th></tr></thead>
    <tbody>
      ${signersRows || '<tr><td colspan="7" class="center muted">Сведения о подписантах отсутствуют</td></tr>'}
    </tbody>
  </table>
  <div class="disclaimer">
    <strong>Подпись не проверялась.</strong> Сведения о подписантах перенесены из исходного XML и не подтверждают факт подписания.
    В этом PDF нет встроенной электронной подписи, штампа оператора или сертификата. Файл подготовлен как самостоятельный документ
    для внешнего подписания: подписывающая сторона должна использовать именно сохранённые байты этого PDF.
  </div>
</section>

${appendixHtml}

<div class="footer-note">
  Печатное представление формализованного XML. Источник: SHA-256 ${e(meta.sourceSha256)}.
  Шаблон ${e(meta.templateVersion)}; формат ${e(meta.formatVersion)}; функция ${e(meta.function)};
  ревизия XSD ${e(meta.schemaRevision)}; операторская версия ${e(meta.operatorVersion)}.
</div>
</body>
</html>`;
}
