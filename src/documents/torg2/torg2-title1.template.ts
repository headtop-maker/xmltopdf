import { escapeHtml } from '../shared/format';
import type { Torg2Title1Model } from './torg2-title1.model';

const e = (value: string | undefined | null): string => escapeHtml(value ?? '');
const dash = (value: string | undefined): string => (value && value.trim() !== '' ? e(value) : '—');

export interface Torg2Title1TemplateOptions {
  readonly fontCss: string;
}

export function renderTorg2Title1Html(model: Torg2Title1Model, options: Torg2Title1TemplateOptions): string {
  const { meta, reference, results } = model;

  const signersRows = model.signers
    .map(
      (signer, index) => `<tr>
        <td class="center">${index + 1}</td>
        <td>${signer.fio ? e(signer.fio) : '<span class="muted">не указано в XML</span>'}</td>
        <td>${dash(signer.position)}</td>
        <td>${dash(signer.organization)}${signer.inn ? `<div class="small muted">ИНН ${e(signer.inn)}</div>` : ''}</td>
        <td>${dash(signer.basis)}${signer.organizationBasis ? `<div class="small muted">${e(signer.organizationBasis)}</div>` : ''}</td>
        <td class="center">${signer.kind}${signer.statusCode ? `<div class="small muted">статус ${e(signer.statusCode)}</div>` : ''}${signer.scopeCode ? `<div class="small muted">полномочия ${e(signer.scopeCode)}</div>` : ''}</td>
      </tr>`,
    )
    .join('\n');

  const infoRows = results.info
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
<title>ТОРГ-2, дополнительные сведения ${e(meta.formedDate)}</title>
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
.plain th { width: 44mm; font-weight: normal; color: #3b434b; }
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
.results-text { font-size: 10pt; }
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
  <div class="org-line">экономический субъект — составитель документа${meta.organizationBasis ? ` · ${e(meta.organizationBasis)}` : ''}</div>
  <div class="doc-caption">ТОРГ-2 · титул продавца · дополнительные сведения · КНД 1175015</div>
  <h1>Дополнительные сведения к документу о приёмке и (или) расхождениях</h1>
  <div class="metrics">
    <div class="metric"><div class="metric-label">Дата формирования</div><div class="metric-value">${dash(meta.formedDate)}</div></div>
    <div class="metric"><div class="metric-label">Время формирования</div><div class="metric-value">${dash(meta.formedTime)}</div></div>
    <div class="metric"><div class="metric-label">КНД</div><div class="metric-value">${e(meta.knd)}</div></div>
    <div class="metric"><div class="metric-label">Версия формата</div><div class="metric-value">${e(meta.formatVersion)}</div></div>
  </div>
  ${meta.sourceId ? `<div class="source-id">Идентификатор файла: ${e(meta.sourceId)}</div>` : ''}
</header>

<section class="avoid">
  <h2>Документ покупателя, к которому относятся сведения</h2>
  <div class="reference">
    <div class="metric-label">Идентификатор файла информации покупателя</div>
    <div class="reference-file mono">${dash(reference.fileId)}</div>
    <div class="small muted">Сформирован: ${dash([reference.formedDate, reference.formedTime].filter(Boolean).join(' '))}</div>
    <div class="small muted">Элементов ЭП в XML: ${reference.signatureCount}. Подпись не проверялась и не печатается.</div>
  </div>
</section>

<section class="avoid">
  <h2>Сведения по итогам приёмки</h2>
  <table class="plain">
    <tr><th>Дата сведений</th><td>${dash(results.date)}</td></tr>
    <tr><th>Содержание</th><td class="results-text">${dash(results.content)}</td></tr>
    ${infoRows}
  </table>
</section>

<section class="avoid">
  <h2>Сведения о подписантах (по данным XML)</h2>
  <table class="grid">
    <thead><tr><th style="width:8mm">№</th><th>Фамилия, имя, отчество</th><th>Должность</th><th>Организация</th><th>Основание полномочий</th><th style="width:26mm">Вид / коды</th></tr></thead>
    <tbody>
      ${signersRows || '<tr><td colspan="6" class="center muted">Сведения о подписантах отсутствуют</td></tr>'}
    </tbody>
  </table>
  <div class="disclaimer">
    <strong>Подпись не проверялась.</strong> Сведения о подписантах и наличии элементов ЭП перенесены из исходного XML.
    Наличие ЭП не доказывает, что подпись действительна, что документ подписан или что сделка завершена.
    В этом PDF нет встроенной электронной подписи. Титул содержит только дополнительные сведения продавца и не
    воспроизводит строки, суммы и подписи титула покупателя.
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
