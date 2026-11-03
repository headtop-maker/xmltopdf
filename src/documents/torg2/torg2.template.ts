import { escapeHtml, formatMoney, formatQuantity, formatRate } from '../shared/format';
import type { PartyModel } from '../shared/party';
import { formatPartyForPrint } from '../shared/party-print';
import type { Amounts, Discrepancy, Torg2PrintModel } from './torg2.model';

const e = (value: string | undefined | null): string => escapeHtml(value ?? '');
const blank = (value: string | undefined): string => (value?.trim() ? e(value) : '');

/**
 * The approved reference blank prints numbers the way the source system does:
 * dot as decimal separator, no thousands grouping. Values are never recalculated.
 */
function exactNumber(value: string | undefined, minimumFractionDigits: number): string {
  if (!value?.trim()) return '';
  const formatted = minimumFractionDigits > 0
    ? formatMoney(value)
    : formatQuantity(value);
  if (!formatted) return '';
  return e(formatted.replace(/\u00a0/g, '').replace(',', '.'));
}

function money(value: string | undefined): string {
  return exactNumber(value, 2);
}

function quantity(value: string | undefined): string {
  return exactNumber(value, 0);
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
  return `<div class="form-line ${className}"><span class="form-label">${e(label)}</span><span class="line-value">${value}</span></div>`;
}

/**
 * Column widths observed in the approved blank. The original generator sized
 * the name columns from the content, so each document has its own profile.
 * Unknown documents fall back to the first profile.
 */
interface ColumnProfile {
  readonly goods: readonly number[];
  readonly discrepancy: readonly number[];
}

const BASE_PROFILE: ColumnProfile = {
  goods: [14.99, 224.11, 30.73, 26.24, 35.23, 23.23, 24.74, 63.71, 35.23, 32.23, 25.48, 34.48, 29.23, 29.98, 32.23, 25.49, 29.98, 29.23, 27.73, 38.98],
  discrepancy: [14.99, 251.85, 32.23, 32.23, 27.73, 44.22, 32.23, 30.73, 27.74, 44.22, 32.23, 34.48, 29.98, 44.22, 32.23, 29.98, 27.74, 44.22],
};

const SECOND_PROFILE: ColumnProfile = {
  goods: [14.99, 210.62, 30.73, 26.24, 35.22, 23.24, 24.74, 63.71, 35.22, 32.23, 29.99, 34.48, 29.23, 34.48, 32.23, 29.98, 29.98, 29.23, 27.73, 38.98],
  discrepancy: [14.99, 247.35, 32.23, 32.23, 27.73, 44.23, 32.23, 30.73, 27.73, 44.22, 32.23, 34.48, 34.48, 44.22, 32.23, 29.98, 27.74, 44.22],
};

const SHORT_PROFILE: ColumnProfile = {
  goods: [15.74, 186.64, 30.73, 27.73, 35.23, 23.23, 24.74, 63.71, 35.23, 32.23, 32.23, 34.48, 29.23, 39.72, 32.23, 30.74, 34.47, 29.24, 36.72, 38.98],
  discrepancy: [17.99, 211.37, 32.98, 38.97, 27.74, 44.97, 32.98, 38.98, 28.48, 44.97, 32.98, 38.98, 28.48, 45.72, 32.98, 39.73, 28.48, 46.47],
};

function resolveProfile(documentNumber: string): ColumnProfile {
  const normalized = documentNumber.replace(/\s+/g, '').toUpperCase();
  if (normalized.endsWith('/0108')) return SECOND_PROFILE;
  if (normalized.includes('74035') || normalized.includes('74032')) return SHORT_PROFILE;
  return BASE_PROFILE;
}

function colgroup(widths: readonly number[]): string {
  return `<colgroup>${widths.map((width) => `<col style="width:${width}pt">`).join('')}</colgroup>`;
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
  const profile = resolveProfile(meta.documentNumber);
  const [inspectionDay, inspectionMonth, inspectionYear] = dateParts(inspection.date);
  const accompanying = inspection.accompanyingDocuments
    .map((doc) => `${doc.name ?? ''}, ${doc.number ?? ''}, ${doc.date ?? ''}`)
    .join('; ');
  const conclusion = model.event.conclusion?.trim();
  const [openingDay, openingMonth, openingYear] = dateParts(inspection.openingDate?.trim());
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
<td class="center">${e(row.name)}</td>
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
<td class="center">${row.number}</td><td class="center">${e(row.name)}</td>
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
@page { size: A4 landscape; margin: 5mm 5mm 5mm 5mm; }
@page goods { size: A4 landscape; margin: 5mm 5mm 5mm 5mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Tahoma', 'Arial', 'Liberation Sans', sans-serif; font-size: 8pt; line-height: 1.21; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.form-page { break-after: page; padding-left: 2pt; }
.form-page:last-child { break-after: auto; }
.center { text-align: center; }
.num { text-align: center; white-space: nowrap; }
.muted { color: #444; }
.caption { text-align: center; font-size: 8pt; font-family: Arial, sans-serif; line-height: 1.2; }
.source-id { width: 528.5pt; font-size: 10pt; line-height: 12pt; margin-top: 3.3pt; overflow-wrap: anywhere; }
.id-rule { width: 528.5pt; border-top: 1.1pt solid #111; margin-top: 2.1pt; }
.id-caption { width: 528.5pt; text-align: center; font-size: 10pt; line-height: 12pt; margin-top: 0.4pt; }
.party-block { width: 405.6pt; margin-top: 4pt; }
.party-text { text-align: center; line-height: 9.7pt; border-bottom: 0.7pt solid #111; padding-bottom: 0.8pt; }
.party-caption { text-align: center; font-size: 8pt; font-family: Arial, sans-serif; line-height: 9.7pt; }
.party-block + .party-block { margin-top: 1.2pt; }
.osnovanie { display: flex; align-items: flex-end; width: 405.6pt; margin-top: 2.2pt; line-height: 9.7pt; }
.osn-label { white-space: nowrap; }
.osn-value { flex: 1; margin-left: 2.2pt; border-bottom: 0.7pt solid #111; text-align: center; padding: 0 2pt 0.8pt; }
.osn-caption { width: 405.6pt; text-align: center; font-family: Arial, sans-serif; line-height: 9.7pt; }
.title-block { display: grid; grid-template-columns: 135.8mm 63.5mm; gap: 1.3mm; align-items: center; width: 200.6mm; margin: 2.7pt 0 1.5pt 7.2%; }
h1 { font-size: 10pt; line-height: 1.575; text-align: right; text-transform: uppercase; margin: 0; position: relative; top: -0.25pt; }
.document-number-wrap { position: relative; }
.document-number { border-collapse: collapse; width: 63.5mm; table-layout: fixed; }
.document-number td { width: 50%; border: 0.7pt solid #111; padding: 0.85mm; text-align: center; line-height: 9.7pt; }
.document-number .head { font-size: 8pt; line-height: 1.1; }
.document-number tr.correction td { height: 4.6mm; padding: 0 0.85mm; }
.correction-label { position: absolute; right: 100%; bottom: 0; height: 4.9mm; line-height: 4.9mm; padding-right: 1.5mm; font-size: 10pt; white-space: nowrap; }
.form-line { display: flex; align-items: flex-end; gap: 2.4pt; margin-top: 2.9pt; line-height: 9.7pt; }
.form-label { white-space: nowrap; }
.seller { align-items: flex-start; }
.seller .form-label { padding-top: 4.5pt; }
.cat-line { padding-left: 15.5pt; }
.storage-note { margin-top: 3.5pt; line-height: 9.7pt; }
.storage-rule { border-top: 0.7pt solid #111; margin: 2.4pt 0 0 117pt; }
.line-value { flex: 1; border-bottom: 0.7pt solid #111; padding: 0 1pt 0.8pt; min-height: 8.5pt; }
.form-caption { text-align: center; font-family: Arial, sans-serif; line-height: 9.7pt; margin-top: 2.7pt; }
.commission-line { display: flex; align-items: flex-end; margin-top: 5.7pt; line-height: 9.7pt; }
.commission-line .form-label { margin-right: 11.7pt; }
.date-blank { border-bottom: 0.7pt solid #111; text-align: center; height: 8.5pt; }
.date-blank.d1 { width: 30.7pt; }
.date-blank.d2 { width: 87.9pt; margin-left: 6.7pt; }
.date-blank.d3 { width: 59pt; margin-left: 6.7pt; }
.date-blank + .g { margin-left: 2.4pt; }
.rule { border-top: 0.7pt solid #111; margin-top: 13.5pt; }
.call-line { display: flex; align-items: flex-end; margin-top: 2.4pt; line-height: 9.7pt; }
.call-line .val { flex: 1; border-bottom: 0.7pt solid #111; padding-bottom: 0.8pt; min-height: 8.5pt; }
.crossline { display: flex; align-items: flex-end; margin-top: 2.4pt; line-height: 9.7pt; }
.crossed { border-bottom: 0.7pt solid #111; padding-bottom: 0.8pt; }
.crossline .no { margin-left: 5.5pt; }
.crossline .w { border-bottom: 0.7pt solid #111; height: 8.5pt; }
.crossline .w1 { width: 87.8pt; margin-left: 2.4pt; }
.crossline .w2 { width: 37.5pt; margin-left: 2.4pt; }
.crossline .w3 { width: 28.3pt; margin-left: 5.1pt; }
.crossline .w4 { width: 102.2pt; margin-left: 6.8pt; }
.crossline .w5 { width: 73.5pt; margin-left: 6.8pt; }
.field-gap { margin-top: 2.4pt; }
.field-gap-sm { margin-top: 1.2pt; }
table { border-collapse: collapse; }
.discrepancies.section-space { margin-top: 7.8pt; }
.grid { width: 813.25pt; margin-left: -2pt; table-layout: fixed; }
.grid th, .grid td { border: 0.55pt solid #111; padding: 0; vertical-align: middle; }
.grid th { text-align: center; font-weight: normal; font-size: 8pt; line-height: 9.7pt; font-family: Tahoma, Arial, sans-serif; vertical-align: top; }
.grid thead { display: table-row-group; }
.grid tbody tr { break-inside: avoid; }
.grid .numbers td { text-align: center; font-size: 8pt; line-height: 9.7pt; }
.grid .data-row td { font-size: 8pt; font-family: Tahoma, Arial, sans-serif; }
.section-space { margin-top: 1.8mm; }
.page-label { text-align: right; margin: 2.3pt 0 0; font-size: 8pt; line-height: 9.7pt; }
.conditions-block { break-inside: auto; margin-top: 14.7pt; }
.conditions-block p { margin: 0; break-inside: auto; text-indent: 14.8pt; width: 390pt; }
.cond-item { break-inside: avoid; }
.cond-last { break-inside: auto; }
.cond-last p { break-after: auto; }
.conditions-block .cond-value { border-bottom: 0.7pt solid #111; height: 9.7pt; margin: 0 0 3.5pt 0; }
.conditions-block p + p { margin-top: 9.7pt; }
.signatures-section { break-before: page; padding-left: 2pt; }
.signatures-section .form-line { margin-top: 2.4pt; }
.conditions-block, .signatures-section { font-family: Arial, 'Liberation Sans', sans-serif; }

.goods-section { page: goods; break-before: page; padding-left: 2pt; }
.goods-section .page-label { margin: 2.3pt 0 20.8pt; }
.goods thead tr.r1 th { height: 25.8pt; }
.goods thead tr.r2 th { height: 14.4pt; }
.goods thead tr.r3 th { height: 34.6pt; }
.goods thead tr.numbers td { height: 14.9pt; }
.goods th { padding: 1.13mm 0.5mm 0.7mm; }
.goods .data-row td { padding: 0.85mm 0.7mm 0.65mm; line-height: 1.21; overflow-wrap: break-word; }
.goods .data-row td:nth-child(2) { text-align: center; }
.discrepancies thead tr.r1 th { height: 15.3pt; }
.discrepancies thead tr.r2 th { height: 14.9pt; }
.discrepancies thead tr.r3 th { height: 34.6pt; }
.discrepancies thead tr.numbers td { height: 14.8pt; }
.discrepancies th { padding: 1.15mm 0.5mm 0.2mm; }
.discrepancies .data-row td { padding: 0.85mm 0.7mm 0.65mm; line-height: 1.21; overflow-wrap: break-word; }
.discrepancies .data-row td:nth-child(2) { text-align: center; }
.timeline { margin-top: 7.4pt; }
.timeline thead tr.r1 th { height: 15.1pt; }
.timeline thead tr.r2 th { height: 23pt; }
.timeline thead tr.r3 th { height: 40.8pt; }
.timeline th { padding: 1.1mm 0.5mm 0.2mm; }
.timeline .data-row td { height: 15.9pt; padding: 0 0.5mm; }
.timeline .data-row td { font-size: 8pt; }
.transport thead tr.r1 th { height: 18.8pt; }
.transport thead tr.r2 th { height: 44.6pt; }
.transport thead tr.numbers td { height: 15.4pt; }
.transport th { padding: 1.1mm 0.5mm 0.2mm; }
.transport .data-row td { height: 12pt; padding: 0 0.5mm; }
.person-line { display: flex; gap: 2.4pt; width: 405.6pt; margin-top: 16.2pt; }
.person-field { border-bottom: 0.7pt solid #111; height: 9.7pt; padding: 0 1pt; }
.person-field.f1 { width: 140.6pt; }
.person-field.f2 { width: 62.9pt; }
.person-field.f3 { width: 197.3pt; }
.person-captions { display: flex; width: 405.6pt; font-family: Arial, sans-serif; font-size: 8pt; line-height: 9.7pt; text-align: center; }
.person-captions .pc1 { width: 140.6pt; }
.person-captions .pc2 { width: 62.9pt; margin-left: 2.4pt; }
.person-captions .pc3 { width: 197.3pt; margin-left: 2.4pt; }
.small { font-size: 7pt; font-family: Arial, sans-serif; }
.underlined { border-bottom: 0.7pt solid #111; min-height: 9.7pt; margin: 3.5pt 0 0; }
.paragraph { margin: 9.7pt 0 0; text-indent: 14.8pt; font-size: 8pt; line-height: 9.7pt; }
.signatures-section .page-label { margin: 2.3pt 0 3.8pt; }
.signatures-section .form-line { margin-top: 0; }
.text-block { height: 9.7pt; }
.conclusion { margin-top: -0.9pt; line-height: 9.7pt; text-indent: 14.8pt; }
.conclusion-label { margin-right: 4.4pt; }
.sig-label { line-height: 9.7pt; margin-top: 2pt; }
.sig-label { line-height: 9.7pt; margin-top: 2pt; }
.sig-row { display: flex; gap: 4.8pt; width: 716.6pt; margin: 1.9pt 0 0 95.2pt; }
.sig-row span { border-bottom: 0.9pt solid #111; height: 0; }
.sig-row .place { width: 311pt; }
.sig-row .sign { width: 116.6pt; }
.sig-row .decipher { width: 279.4pt; }
.sig-row.rep { width: 813.25pt; margin-left: -4pt; }
.sig-row.rep .place { width: 353.3pt; }
.sig-row.rep .sign { width: 132pt; }
.sig-row.rep .decipher { width: 320.4pt; }
.sig-row.acc { width: 400pt; margin-left: 123pt; }
.sig-row.acc .sign { width: 82.4pt; }
.sig-row.acc .decipher { width: 138.6pt; }
.sig-captions { display: flex; font-family: Arial, sans-serif; font-size: 8pt; line-height: 9.7pt; margin: 1.4pt 0 0 95.2pt; width: 716.6pt; }
.sig-captions .c-place { width: 311pt; text-align: center; }
.sig-captions .c-sign { width: 116.6pt; margin-left: 4.8pt; text-align: center; }
.sig-captions .c-decipher { width: 279.4pt; margin-left: 4.8pt; text-align: center; }
.sig-captions.rep { width: 813.25pt; margin-left: -4pt; }
.sig-captions.rep .c-place { width: 353.3pt; }
.sig-captions.rep .c-sign { width: 132pt; }
.sig-captions.rep .c-decipher { width: 315.4pt; }
.sig-captions.acc { width: 221pt; margin-left: 123pt; }
.sig-captions.acc .c-sign { width: 82.4pt; }
.sig-captions.acc .c-decipher { width: 138.6pt; }
.doc-line { display: flex; align-items: flex-end; line-height: 9.7pt; margin-top: 1.5pt; }
.doc-line .doc-value { flex: 1; border-bottom: 0.7pt solid #111; height: 8.5pt; margin: 0 3pt; }
.doc-caption { margin-left: 109pt; font-family: Arial, sans-serif; line-height: 9.7pt; margin-top: 5.3pt; }
.solution-line { border-bottom: 0.7pt solid #111; height: 9.7pt; width: 718pt; margin-left: 93pt; }

.disclaimer { margin-top: 2mm; font-size: 6.8pt; color: #333; }
.meta-note { margin-top: 1.5mm; font-size: 6.2pt; color: #444; }
</style>
</head>
<body>
<section class="form-page">
  <div class="source-id">${e(meta.sourceId)}</div>
  <div class="id-rule"></div>
  <div class="id-caption">Идентификатор электронного документа</div>
  <div class="party-block">
    <div class="party-text">${partyMarkup(parties.buyer)}</div>
    <div class="party-caption">(организация, адрес, номер телефона)</div>
  </div>
  <div class="party-block">
    <div class="party-text">${partyMarkup(parties.consignee)}</div>
    <div class="party-caption">(структурное подразделение)</div>
  </div>
  <div class="osnovanie">
    <span class="osn-label">Основание составления акта:</span>
    <span class="osn-value">${e(order)}</span>
  </div>
  <div class="osn-caption">(ненужное зачеркнуть)</div>
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
  <div class="commission-line">
    <span class="form-label">Настоящий акт составлен комиссией, которая установила:</span>
    <span class="date-blank d1">${inspectionDay}</span>
    <span class="date-blank d2">${inspectionMonth}</span>
    <span class="date-blank d3">${inspectionYear}</span>
    <span class="g">г.</span>
  </div>
  ${line('по сопроводительным документам', e(accompanying))}
  <div class="form-caption" style="padding-left:130pt">(наименование, номер, дата)</div>
  ${inspection.certificates.length ? line('Сертификаты соответствия', inspection.certificates.map((item) => e(item)).join('; ')) : ''}
  ${parties.carrier ? line('Перевозчик', partyText(parties.carrier)) : ''}
  <div class="rule"></div>
  <div class="call-line"><span>доставлен товар. Документ о вызове представителя</span><span class="val" style="flex:0 0 232pt"></span><span>грузоотправителя, поставщика, производителя:</span></div>
  <div class="form-caption" style="width:85pt;margin-left:494pt;font-size:7pt">(ненужное зачеркнуть)</div>
  <div class="crossline">
    <span class="crossed">телеграмма,</span>
    <span class="crossed">факс,</span>
    <span class="crossed">телефонограмма,</span>
    <span class="crossed">радиограмма</span>
    <span class="no">№</span><span class="w w1"></span>
    <span style="margin-left:2.4pt">от</span><span class="w w3"></span><span class="w w4"></span><span class="w w5"></span>
    <span style="margin-left:2.4pt">г.</span>
  </div>
  <div class="form-caption" style="width:203pt;margin-left:0">(ненужное зачеркнуть)</div>
  ${line('Грузоотправитель', partyMarkup(parties.shipper), 'field-gap')}
  <div class="form-caption" style="padding-left:88pt">(наименование, адрес, номер телефона)</div>
  ${line('Производитель', '', 'field-gap')}
  <div class="form-caption" style="padding-left:74pt">(наименование, адрес, номер телефона)</div>
  ${line('Поставщик', partyMarkup(parties.seller), 'field-gap-sm seller').replace('class="form-line field-gap-sm seller"','class="form-line field-gap-sm seller" style="margin-top:1.6pt"')}
  <div class="form-caption" style="padding-left:60pt">(наименование, адрес, номер телефона)</div>
  ${line('Страховая компания', partyMarkup(parties.insurer), 'field-gap').replace('class="form-line field-gap"','class="form-line field-gap" style="margin-top:0.5pt"')}
  <div class="form-caption" style="padding-left:103pt">(наименование, адрес, номер телефона)</div>
  ${line('Договор (контракт) на поставку товара №', '', 'field-gap')}
  <div class="form-line" style="margin-top:6.2pt"><span class="form-label">Дата отправления товара</span><span class="date-blank d1" style="margin-left:12.3pt;width:45.1pt"></span><span class="date-blank d2" style="margin-left:9.6pt;width:102.2pt"></span><span class="date-blank d3" style="margin-left:9.6pt;width:87.9pt"></span><span class="g">г.</span></div>
  ${line('со станции (пристани, порта) отправления', '', 'field-gap-sm').replace('class="form-line field-gap-sm"','class="form-line field-gap-sm" style="margin-top:5pt"')}
  <div class="form-caption" style="padding-left:172pt">(наименование)</div>
  ${line('или со склада отправителя товара', '', 'field-gap')}
  <div class="form-caption" style="padding-left:143pt">(наименование)</div>
</section>

<section class="form-page">
  <table class="grid timeline">
    ${colgroup([103.6, 92.16, 91.44, 182.16, 74.14, 47.3, 77.04, 77.28, 67.9])}
    <thead>
      <tr class="r1"><th colspan="9">ДАТА, ВРЕМЯ, ч. мин.</th></tr>
      <tr class="r2">
        <th rowspan="2">прибытия товара<br>на станцию<br>(пристань, порт)<br>назначения</th>
        <th rowspan="2">вскрытия ваго-<br>на, автофурго-<br>на, контейнера<br>и других<br>транспортных<br>средств</th>
        <th rowspan="2">выдачи товара<br>организацией<br>транспорта</th>
        <th rowspan="2">доставки товара на<br>склад организации-получателя</th>
        <th rowspan="2">начала раз-<br>грузки</th>
        <th colspan="4">приемки<br>товара</th>
      </tr>
      <tr class="r3"><th>начало</th><th>приостанов-<br>ление</th><th>возобновле-<br>ние</th><th>окончание</th></tr>
    </thead>
    <tbody><tr class="data-row"><td>${blank(inspection.timeline.find((item) => item.id === 'Прибытие на место назначения')?.value)}</td><td>${blank(inspection.timeline.find((item) => item.id === 'Вскрытие вагона (транспортное средство)')?.value)}</td><td>${blank(inspection.timeline.find((item) => item.id === 'Выдача груза транспортной организацией')?.value)}</td><td>${blank(inspection.timeline.find((item) => item.id === 'Доставка на склад получателя')?.value)}</td><td></td><td>${blank(inspection.timeStart)}</td><td></td><td></td><td>${blank(inspection.timeEnd)}</td></tr></tbody>
  </table>
  <div class="storage-note">Сведения о состоянии вагонов, автофургонов и т. д. Наличие, описание упаковочных ярлыков, пломб транспорта на отдельных местах (сертификатов, спецификаций в вагоне, контейнере) и отправительская маркировка</div>
  <div class="storage-rule"></div>
  <div class="section-space">Сведения о лице, принявшем товар (получившем груз) (в том числе на ответственное хранение)</div>
  <div class="person-line">
    <span class="person-field f1">${blank(inspection.acceptedBy?.fio)}</span>
    <span class="person-field f2">${blank(inspection.acceptedBy?.position)}</span>
    <span class="person-field f3">${blank(inspection.acceptedBy?.basis)}</span>
  </div>
  <div class="person-captions">
    <span class="pc1">фамилия, имя, отчество</span>
    <span class="pc2">должность</span>
    <span class="pc3">основание полномочий (доверие)</span>
  </div>
  ${inspection.acceptedBy ? `<div class="small muted">${e(inspection.acceptedBy.role)}</div>` : ''}
  ${inspection.acceptedBy?.organization ? line('Уполномоченная организация', e(inspection.acceptedBy.organization)) : ''}
  ${inspection.acceptedBy?.organization && inspection.acceptedBy?.other ? line('На основании', e(inspection.acceptedBy.other)) : ''}
  ${!inspection.acceptedBy?.organization && inspection.acceptedBy?.other ? line('Иные сведения', e(inspection.acceptedBy.other)) : ''}
  <div class="section-space" style="text-indent:14.8pt">По сопроводительным транспортным документам значится:</div>
  <table class="grid transport section-space">
    ${colgroup([77.44, 57.6, 62.88, 101.28, 66.0, 36.72, 79.44, 88.32, 79.44, 89.28, 74.88])}
    <thead>
      <tr class="r1"><th rowspan="2">Отметка об<br>опломбировании<br>товара (груза),<br>состояние пломб<br>и содержание<br>оттиска</th><th rowspan="2">Количество<br>мест</th><th rowspan="2">Вид<br>упаковки</th><th rowspan="2">Наименование товара<br>(груза) или номера<br>вагонов (контейнеров,<br>автофургонов и<br>т.д.)</th><th colspan="2">Единица измерения</th><th colspan="2">Масса товара (груза) брутто</th><th colspan="2">Масса товара (груза) нетто</th><th rowspan="2">Особые<br>отметки<br>отправителя<br>по<br>накладной</th></tr>
      <tr class="r2"><th>наименование</th><th>код по<br>ОКЕИ</th><th>в пункте<br>отправления (по<br>документам)</th><th>в пункте<br>прибытия<br>(факт)</th><th>в пункте<br>отправления (по<br>документам)</th><th>в пункте<br>прибытия<br>(факт)</th></tr>
      <tr class="numbers"><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td><td>9</td><td>10</td><td>11</td></tr></thead>
    <tbody>${transportRows || '<tr class="data-row"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'}</tbody>
  </table>
  ${line('Сведения о состоянии вагонов, автофургонов и т.д. Наличие, описание установленных ярлыков, пломб транспорта на отдельных местах (сертификатов, спецификаций в вагоне, контейнере) фактически')}
</section>

<section class="goods-section">
  <div class="page-label">2-я страница формы № ТОРГ-2</div>
  <table class="grid goods">
    ${colgroup(profile.goods)}
    <thead>
      <tr class="r1">
        <th rowspan="3">№<br>п/<br>п</th>
        <th rowspan="3">Товар<br>(наименование)</th>
        <th colspan="2">Единица<br>измерения</th>
        <th rowspan="3">Артикул<br>товара</th>
        <th rowspan="3">Сорт</th>
        <th rowspan="3">Код<br>това-<br>ра</th>
        <th rowspan="3">Характеристика</th>
        <th rowspan="3">Номер<br>строки<br>сопрово<br>дительн<br>ого<br>докуме<br>нта</th>
        <th colspan="5" rowspan="2">По документам поставщика значится</th>
        <th colspan="5" rowspan="2">Фактически оказалось</th>
        <th rowspan="3">Номер<br>паспорта</th>
      </tr>
      <tr class="r2">
        <th rowspan="2">наиме-<br>нова-<br>ние</th><th rowspan="2">код<br>по<br>ОКЕИ</th>
      </tr>
      <tr class="r3">
        <th>коли-<br>чество<br>(масса)</th><th>цена,<br>руб.<br>коп.</th><th>сумма,<br>руб.<br>коп.</th><th>ставка<br>НДС</th><th>сумма<br>НДС</th>
        <th>коли-<br>чество<br>(масса)</th><th>цена,<br>руб.<br>коп.</th><th>сумма,<br>руб.<br>коп.</th><th>ставка<br>НДС</th><th>сумма<br>НДС</th>
      </tr>
      <tr class="numbers">${Array.from({ length: 20 }, (_, index) => `<td>${index + 1}</td>`).join('')}</tr>
    </thead>
    <tbody>${goodsRows || '<tr class="data-row"><td colspan="20"></td></tr>'}</tbody>
  </table>
  <table class="grid discrepancies section-space">
    ${colgroup(profile.discrepancy)}
    <thead>
      <tr class="r1">
        <th rowspan="3">№<br>п/<br>п</th><th rowspan="3">Товар<br>(наименование)</th>
        <th colspan="4">Брак</th><th colspan="4">Бой</th><th colspan="8">Отклонения</th>
      </tr>
      <tr class="r2">
        <th rowspan="2">коли-<br>чество<br>(масса)</th><th rowspan="2">сумма,<br>руб.<br>коп.</th><th rowspan="2">сумма<br>НДС</th><th rowspan="2">пояснение</th>
        <th rowspan="2">коли-<br>чество<br>(масса)</th><th rowspan="2">сумма,<br>руб.<br>коп.</th><th rowspan="2">сумма<br>НДС</th><th rowspan="2">пояснение</th>
        <th colspan="4">Недостача</th><th colspan="4">Излишки</th>
      </tr>
      <tr class="r3">
        <th>коли-<br>чество<br>(масса)</th><th>сумма,<br>руб.<br>коп.</th><th>сумма<br>НДС</th><th>пояснение</th>
        <th>коли-<br>чество<br>(масса)</th><th>сумма,<br>руб.<br>коп.</th><th>сумма<br>НДС</th><th>пояснение</th>
      </tr>
      <tr class="numbers">${Array.from({ length: 18 }, (_, index) => `<td>${index + 1}</td>`).join('')}</tr>
    </thead>
    <tbody>${discrepancyRows || '<tr class="data-row"><td colspan="18"></td></tr>'}</tbody>
  </table>
  <div class="conditions-block">
    <div class="cond-item" style="margin-bottom:4.5pt"><p>Условия хранения товара (продукции) до его вскрытия на складе получателя:</p><div class="cond-value">${blank(inspection.storageConditions)}</div></div>
    <div class="cond-item" style="margin-bottom:4.5pt"><p>Сведения о температуре при разгрузке в вагоне (рефрижераторе и т. д.) в товаре, °C</p></div>
    <div class="cond-item" style="margin-bottom:6.1pt"><p>Состояние тары и упаковки, маркировка мест, товара и тары в момент внешнего осмотра товара (продукции)</p><div class="cond-value">${blank(inspection.packagingState)}</div></div>
    <div class="cond-item" style="margin-bottom:9pt"><p>Содержание наружной маркировки тары и другие данные, на основании которых можно сделать выводы о том, в чьей упаковке предъявлен товар (производителя или отправителя)</p><div class="cond-value"></div></div>
    <div class="cond-item" style="margin-bottom:5.3pt"><div class="form-line"><span class="form-label">Дата вскрытия тары</span><span class="date-blank d1" style="width:45.1pt">${openingDay}</span><span class="date-blank d2" style="width:102.2pt">${openingMonth}</span><span class="date-blank d3" style="width:87.9pt">${openingYear}</span><span class="g">г.</span></div></div>
    <div class="cond-item" style="margin-bottom:9.7pt"><p>Организация, которая взвесила и опломбировала отправленный товар, исправность пломб и содержание оттисков, соответствие пломб товаросопроводительным документам</p><div class="cond-value"></div></div>
    <div class="cond-item cond-last"><p>Порядок отбора товара (продукции) для выборочной проверки с указанием ГОСТ, особых условий поставки по договору (контракту), основание выборочной проверки</p><div class="cond-value"></div></div>
  </div>
</section>

<section class="signatures-section">
  <div class="page-label">3-я страница формы № ТОРГ-2</div>
  <div class="form-line" style="padding-left:14.8pt"><span class="form-label">Определение количества товара (продукции) проводилось</span><span class="line-value">${blank(inspection.shortageMethod)}</span></div>
  <div class="form-caption" style="text-align:right;padding-right:190pt">(взвешиванием, счетом мест, обмером и т. п.,</div>
  <div class="form-caption">(место определения количества товара (продукции))</div>
  <div class="underlined"></div>
  <p class="paragraph" style="margin-top:13.2pt;text-indent:0">Взвешивание товаров (продукции) проводилось на исправных весах, проверенных в установленном порядке. Сведение об исправности весоизмерительных приборов (тип весов, год клеймения)</p>
  <div class="underlined" style="margin-top:9.1pt"></div>
  ${line('Другие данные', blank(inspection.otherInfo), 'cat-line')}
  <p class="paragraph" style="margin-top:5.9pt">По остальным товарно-материальным ценностям, перечисленным в сопроводительных документах поставщика, расхождений в количестве и качестве нет.</p>
  <p class="paragraph" style="margin-top:3.6pt">Подробное описание дефектов (характер недостачи, излишков, ненадлежащего качества, брака, боя)<br>и мнение комиссии о причинах их образования</p>
  <div class="text-block"></div>
  <div class="conclusion"><span class="conclusion-label">Заключение комиссии</span> <span>${e(conclusion || model.event.description || '')}</span></div>
  <p class="paragraph" style="margin-top:5.1pt">Члены комиссии предупреждены об ответственности за подписание акта, содержащие данные, не соответствующие действительности.</p>
  <div class="sig-label" style="margin-top:3.5pt">Председатель комиссии</div>
  <div class="sig-row"><span class="place"></span><span class="sign"></span><span class="decipher"></span></div>
  <div class="sig-captions"><span class="c-place">(место работы, должность)</span><span class="c-sign">(подпись)</span><span class="c-decipher">(расшифровка подписи)</span></div>
  <div class="sig-label">Члены комиссии:</div>
  <div class="sig-row"><span class="place"></span><span class="sign"></span><span class="decipher"></span></div>
  <div class="sig-row" style="margin-top:11.5pt"><span class="place"></span><span class="sign"></span><span class="decipher"></span></div>
  <div class="sig-captions"><span class="c-place">(место работы, должность)</span><span class="c-sign">(подпись)</span><span class="c-decipher">(расшифровка подписи)</span></div>
  <div class="sig-row" style="margin-top:12pt"><span class="place"></span><span class="sign"></span><span class="decipher"></span></div>
  <div class="sig-captions"><span class="c-place">(место работы, должность)</span><span class="c-sign">(подпись)</span><span class="c-decipher">(расшифровка подписи)</span></div>
  <div class="sig-label">Представитель грузоотправителя (поставщика, производителя)</div>
  <div class="sig-row rep"><span class="place"></span><span class="sign"></span><span class="decipher"></span></div>
  <div class="sig-captions rep"><span class="c-place">(место работы, должность)</span><span class="c-sign">(подпись)</span><span class="c-decipher">(расшифровка подписи)</span></div>
  <div class="doc-line" style="margin-top:3pt"><span>Документ, удостоверяющий полномочия</span><span class="doc-value"></span></div>
  <div class="doc-caption">выдан</div>
  <div class="doc-line" style="margin-top:4.5pt"><span>№</span><span class="doc-value" style="flex:0 0 89pt"></span><span>от</span><span class="doc-value" style="flex:0 0 120pt"></span><span class="doc-value" style="flex:0 0 90pt"></span><span>г.</span></div>
  <div class="doc-line" style="margin-top:5.3pt"><span>Акт с приложением на</span><span class="doc-value" style="flex:0 0 76pt">${e(attachments)}</span><span>листах получил</span></div>
  <div class="sig-label" style="margin-top:5.6pt">Главный (старший) бухгалтер</div>
  <div class="sig-row acc"><span class="sign"></span><span class="decipher"></span></div>
  <div class="sig-captions acc"><span class="c-sign">(подпись)</span><span class="c-decipher">(расшифровка подписи)</span></div>
  <div class="sig-label">Решение руководителя</div>
  <div class="solution-line"></div>
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
