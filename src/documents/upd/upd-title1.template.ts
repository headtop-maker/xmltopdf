import { escapeHtml } from '../shared/format';
import type { DocumentRef } from '../torg2/torg2.model';
import type { UpdTitle1Model } from './upd-title1.model';

const e = (value: string | undefined | null): string => escapeHtml(value ?? '');
const dash = (value: string | undefined): string => (value && value.trim() !== '' ? e(value) : '—');

function docRefText(doc: DocumentRef): string {
  return [`${dash(doc.kind)} № ${dash(doc.number)}`, doc.date ? `от ${e(doc.date)}` : undefined]
    .filter(Boolean)
    .join(' ');
}

export interface UpdTitle1TemplateOptions {
  readonly fontCss: string;
}

export function renderUpdTitle1Html(model: UpdTitle1Model, options: UpdTitle1TemplateOptions): string {
  const { meta, reference, content, acceptance, procurement } = model;

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

  const infoRows = [...model.info]
    .map((item) => `<tr><th>${dash(item.id)}</th><td>${dash(item.value)}</td></tr>`)
    .join('');

  const procurementRows = procurement
    .map((item) => `<tr><th>${dash(item.id)}</th><td>${dash(item.value)}</td></tr>`)
    .join('');

  const appendixHtml = model.appendix.length
    ? `<section class="appendix">
  <h2>Приложение. Реквизиты исходного XML, не вошедшие в основной бланк</h2>
  <p class="small muted">Приложение является частью этого же PDF. Источник XML: SHA-256 ${e(meta.sourceSha256)}.</p>
  ${model.appendix
    .map(
      (group) => `<div class="appendix-group">
      <h3>${e(group.title)}</h3>
      <table class="grid appendix-table">
        <thead><tr><th class="idx">№</th><th>Реквизит</th><th>Значение</th></tr></thead>
        <tbody>
          ${group.rows
            .map(
              (row, index) => `<tr><td class="center">${index + 1}</td>
            <td><div>${e(row.label)}</div><div class="small muted mono">${e(row.path)}</div></td>
            <td class="value">${e(row.value)}</td></tr>`,
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
<title>УПД, информация покупателя ${e(content.documentNumber ?? '')}</title>
<style>
${options.fontCss}
@page { size: A4 portrait; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'PT Sans', 'DejaVu Sans', sans-serif; font-size: 9.5pt; line-height: 1.35; color: #14171a;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 14pt; line-height: 1.25; margin: 1mm 0; text-align: center; }
h2 { font-size: 10.5pt; margin: 5mm 0 2mm 0; text-transform: uppercase; letter-spacing: 0.02em;
  border-bottom: 0.6pt solid #9aa4ae; padding-bottom: 1mm; }
h3 { font-size: 9.5pt; margin: 3mm 0 1.2mm 0; }
p { margin: 1mm 0; }
table { border-collapse: collapse; width: 100%; }
.grid th, .grid td { border: 0.5pt solid #5a636c; padding: 1.2mm 1.6mm; vertical-align: top; }
.grid thead th { background: #eef1f4; font-size: 8pt; text-align: center; }
.grid tbody td { font-size: 8.6pt; }
.plain th, .plain td { padding: 0.9mm 2mm 0.9mm 0; vertical-align: top; text-align: left; }
.plain th { width: 48mm; font-weight: normal; color: #3b434b; }
.small { font-size: 7.4pt; }
.muted { color: #5c656e; }
.mono { word-break: break-all; }
.center { text-align: center; }
.avoid { break-inside: avoid; }
.doc-head { border: 0.8pt solid #2f363d; padding: 4mm 5mm; margin-bottom: 4mm; }
.org-name { font-size: 11pt; font-weight: bold; }
.org-line { font-size: 8pt; color: #5c656e; margin-bottom: 3mm; }
.doc-caption { text-align: center; font-size: 8pt; color: #5c656e; letter-spacing: 0.05em; }
.metrics { display: grid; grid-template-columns: 1fr 1fr; margin-top: 3mm; border-top: 0.5pt solid #9aa4ae; }
.metric { padding: 1.4mm 2mm 1.4mm 0; border-right: 0.4pt solid #c4cad0; }
.metric:nth-child(even) { border-right: none; }
.metric-label { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.04em; color: #5c656e; }
.metric-value { font-size: 9.5pt; font-weight: bold; margin-top: 0.3mm; }
.source-id { margin-top: 2mm; font-size: 7pt; color: #5c656e; word-break: break-all; }
.reference { border-left: 2.5pt solid #2f363d; padding: 2mm 0 2mm 3mm; }
.reference-file { font-size: 8pt; word-break: break-all; }
.result-code { font-size: 16pt; font-weight: bold; }
.disclaimer { border: 0.6pt dashed #8a939c; padding: 2.5mm 3mm; font-size: 8.2pt; margin-top: 3mm; background: #fafbfc; }
.appendix { break-before: page; }
.appendix-table td.value { word-break: break-word; }
.appendix-table .idx { width: 10mm; }
.footer-note { margin-top: 4mm; font-size: 7.2pt; color: #5c656e; }
</style>
</head>
<body>

<header class="doc-head">
  <div class="org-name">${e(meta.organization)}</div>
  <div class="org-line">экономический субъект — составитель документа</div>
  <div class="doc-caption">УПД · титул покупателя · информация о приёмке · КНД 1115132</div>
  <h1>Информация покупателя о принятии товаров (работ, услуг), имущественных прав</h1>
  <div class="metrics">
    <div class="metric"><div class="metric-label">Дата формирования</div><div class="metric-value">${dash(meta.formedDate)}</div></div>
    <div class="metric"><div class="metric-label">Время формирования</div><div class="metric-value">${dash(meta.formedTime)}</div></div>
    <div class="metric"><div class="metric-label">Функция документа продавца</div><div class="metric-value">${dash(meta.function)}</div></div>
    <div class="metric"><div class="metric-label">КНД</div><div class="metric-value">${e(meta.knd)}</div></div>
    <div class="metric"><div class="metric-label">Версия формата</div><div class="metric-value">${e(meta.formatVersion)}</div></div>
    <div class="metric"><div class="metric-label">УИД</div><div class="metric-value mono" style="font-size:7pt">${dash(meta.documentUid)}</div></div>
  </div>
  ${meta.sourceId ? `<div class="source-id">Идентификатор файла: ${e(meta.sourceId)}</div>` : ''}
</header>

<section class="avoid">
  <h2>Документ продавца, к которому относится подтверждение</h2>
  <div class="reference">
    <div class="metric-label">Идентификатор файла информации продавца</div>
    <div class="reference-file mono">${dash(reference.sellerFileId)}</div>
    <div class="small muted">Сформирован: ${dash([reference.formedDate, reference.formedTime].filter(Boolean).join(' '))}</div>
    <div class="small muted">Элементов ЭП в XML: ${reference.signatureCount}. Подпись не проверялась и не печатается.</div>
  </div>
</section>

<section class="avoid">
  <h2>Содержание факта хозяйственной жизни</h2>
  <table class="plain">
    <tr><th>Наименование документа</th><td>${dash(content.documentName)}</td></tr>
    <tr><th>Функция документа продавца</th><td>${dash(content.function)}</td></tr>
    <tr><th>Номер документа продавца</th><td>${dash(content.documentNumber)}</td></tr>
    <tr><th>Дата документа продавца</th><td>${dash(content.documentDate)}</td></tr>
    <tr><th>Вид операции</th><td>${dash(content.operationType)}</td></tr>
    ${model.authorityBasis ? `<tr><th>Основание полномочий составителя</th><td>${docRefText(model.authorityBasis)}</td></tr>` : ''}
  </table>
</section>

<section class="avoid">
  <h2>Сведения о приёмке</h2>
  <table class="plain">
    <tr><th>Дата принятия</th><td>${dash(acceptance.date)}</td></tr>
    <tr><th>Содержание операции</th><td>${dash(acceptance.operation)}</td></tr>
    <tr><th>Код итога приёмки</th><td><span class="result-code">${dash(acceptance.resultCode)}</span><div class="small muted">код по формату; смысл итога выводится из кода и не заменяет документ продавца</div></td></tr>
    ${acceptance.discrepancyDocument ? `<tr><th>Документ о расхождениях</th><td>${docRefText(acceptance.discrepancyDocument)}</td></tr>` : ''}
    ${
      acceptance.person
        ? `<tr><th>Товар принял</th><td>${dash(acceptance.person.fio)}${acceptance.person.position ? `, ${e(acceptance.person.position)}` : ''}${acceptance.person.organization ? `, ${e(acceptance.person.organization)}` : ''}${acceptance.person.inn ? `, ИНН ${e(acceptance.person.inn)}` : ''}${acceptance.person.basis ? `<div class="small muted">Основание: ${e(acceptance.person.basis)}</div>` : ''}${acceptance.person.other ? `<div class="small muted">${e(acceptance.person.other)}</div>` : ''}<div class="small muted">${e(acceptance.person.role)}</div></td></tr>`
        : ''
    }
    ${infoRows}
  </table>
</section>

${
  procurementRows
    ? `<section class="avoid">
  <h2>Информация об обстоятельствах закупок для государственных и муниципальных нужд</h2>
  <table class="plain">${procurementRows}</table>
</section>`
    : ''
}

<section class="avoid">
  <h2>Сведения о подписантах (по данным XML)</h2>
  <table class="grid">
    <thead><tr><th style="width:8mm">№</th><th>Фамилия, имя, отчество</th><th>Должность</th><th>Тип подписи</th><th>Способ подтверждения полномочий</th><th>Доверенности</th><th>Дата подписания</th></tr></thead>
    <tbody>
      ${signersRows || '<tr><td colspan="7" class="center muted">Сведения о подписантах отсутствуют</td></tr>'}
    </tbody>
  </table>
  <div class="disclaimer">
    <strong>Подпись не проверялась.</strong> Наличие элементов ЭП в XML и сведения о подписантах не доказывают,
    что подпись действительна или что сделка завершена: статус завершения нельзя вывести только из этого файла.
    В этом PDF нет встроенной электронной подписи; титул не воспроизводит товарные строки и итоги документа продавца.
  </div>
</section>

${appendixHtml}

<div class="footer-note">
  Печатное представление формализованного XML. Источник: SHA-256 ${e(meta.sourceSha256)}.
  Шаблон ${e(meta.templateVersion)}; формат ${e(meta.formatVersion)}; ревизия XSD ${e(meta.schemaRevision)};
  операторская версия ${e(meta.operatorVersion)}.
</div>
</body>
</html>`;
}
