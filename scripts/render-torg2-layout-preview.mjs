#!/usr/bin/env node
/**
 * Standalone geometry preview for the compiled TORG-2 layout.
 * It renders the template row ranges with placeholders visible, so the
 * compiled geometry can be compared with the vislib/Saby output before the
 * data mapper is connected. It does not import or modify the Nest service.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { globSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const layoutPath = process.argv[2] ?? 'test-output/torg2-layout.json';
const outPdf = process.argv[3] ?? 'test-output/torg2-layout-preview.pdf';
const layout = JSON.parse(readFileSync(layoutPath, 'utf8'));

const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 3;
const groups = [
  { name: '1. Шапка и стороны', from: 1, to: 107 },
  { name: '2. Транспортная страница', from: 108, to: 137 },
  { name: '3. Товары и расхождения', from: 138, to: 148 },
  { name: '4. Заключение и подписи', from: 149, to: 187 },
  { name: '5. Приложение', from: 188, to: 240 },
];

const esc = (v) => String(v ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const colOffset = [];
let acc = 0;
for (const c of layout.columns) { colOffset[c.index] = acc; acc += c.widthMm; }
const rowOffset = [];
acc = 0;
for (const r of layout.rows) { rowOffset[r.index] = acc; acc += r.heightMm; }

const width = layout.columns.reduce((s, c) => s + c.widthMm, 0);
const scale = (PAGE_W - MARGIN * 2) / width;

const cellsByRow = new Map();
for (const cell of layout.cells) {
  if (!cellsByRow.has(cell.row)) cellsByRow.set(cell.row, []);
  cellsByRow.get(cell.row).push(cell);
}
const merges = layout.merges;

function mergeAt(row, col, pageFrom, pageTo) {
  return merges.find((m) => row >= m.minRow && row <= m.maxRow && col >= m.minCol && col <= m.maxCol
    && m.maxRow >= pageFrom && m.minRow <= pageTo);
}

function cellHtml(cell, row, col, pageFrom, pageTo) {
  const merge = mergeAt(row, col, pageFrom, pageTo);
  if (merge && (row !== Math.max(merge.minRow, pageFrom) || col !== merge.minCol)) return '';
  const top = (rowOffset[row] - rowOffset[pageFrom]) * scale;
  const left = colOffset[col] * scale;
  const height = merge ? (rowOffset[Math.min(merge.maxRow, pageTo) + 1] - rowOffset[Math.max(merge.minRow, pageFrom)]) * scale
    : layout.rows[row - 1].heightMm * scale;
  const w = merge ? layout.columns.filter((c) => c.index >= merge.minCol && c.index <= merge.maxCol).reduce((s, c) => s + c.widthMm, 0) * scale
    : layout.columns[col - 1].widthMm * scale;
  const style = cell.style ?? {};
  const border = style.border ?? {};
  const borders = ['top', 'right', 'bottom', 'left']
    .filter((s) => border[s]?.style)
    .map((s) => `border-${s}:0.45pt solid #111;`).join('');
  const align = style.alignment ?? {};
  const halign = align.horizontal === 'right' ? 'right' : align.horizontal === 'center' ? 'center' : 'left';
  const valign = align.vertical === 'top' ? 'flex-start' : align.vertical === 'bottom' ? 'flex-end' : 'center';
  const font = style.font ?? {};
  const size = (font.size ?? 10) * scale;
  const weight = font.bold ? '700' : '400';
  const italic = font.italic ? 'italic' : 'normal';
  const value = cell.value == null ? '' : String(cell.value);
  const text = esc(value).replaceAll('\n', '<br>');
  const fill = style.fill?.type ? `background:#${String(style.fill.color ?? 'ffffff').slice(-6)};` : '';
  return `<div class="cell" style="top:${top.toFixed(3)}mm;left:${left.toFixed(3)}mm;width:${w.toFixed(3)}mm;height:${height.toFixed(3)}mm;${borders}${fill}
    font-size:${size.toFixed(2)}pt;font-weight:${weight};font-style:${italic};text-align:${halign};align-items:${valign};">${text}</div>`;
}

function renderPage(pageFrom, pageTo, groupName, pageNo) {
  const parts = [];
  const covered = new Set();
  for (let row = pageFrom; row <= pageTo; row++) {
    const rowCells = cellsByRow.get(row) ?? [];
    for (const cell of rowCells) {
      if (covered.has(`${cell.row}:${cell.col}`)) continue;
      const merge = mergeAt(cell.row, cell.col, pageFrom, pageTo);
      if (merge && (cell.row !== Math.max(merge.minRow, pageFrom) || cell.col !== merge.minCol)) continue;
      if (merge) {
        for (let r = Math.max(merge.minRow, pageFrom); r <= Math.min(merge.maxRow, pageTo); r++) {
          for (let c = merge.minCol; c <= merge.maxCol; c++) covered.add(`${r}:${c}`);
        }
      }
      const cellRow = merge ? Math.max(merge.minRow, pageFrom) : cell.row;
      if (cellRow < pageFrom || cellRow > pageTo) continue;
      parts.push(cellHtml(cell, cellRow, cell.col, pageFrom, pageTo));
    }
  }
  return `<section class="page"><div class="group">${esc(groupName)}</div>${parts.join('')}
    <div class="pageno">${pageNo}</div></section>`;
}

const pages = [];
let pageNo = 1;
for (const group of groups) {
  let pageFrom = group.from;
  let used = 0;
  for (let row = group.from; row <= group.to; row++) {
    const h = layout.rows[row - 1].heightMm * scale;
    if (used > 0 && used + h > PAGE_H - MARGIN * 2) {
      pages.push(renderPage(pageFrom, row - 1, group.name, pageNo++));
      pageFrom = row;
      used = 0;
    }
    used += h;
  }
  if (pageFrom <= group.to) pages.push(renderPage(pageFrom, group.to, group.name, pageNo++));
}

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
.page { position: relative; width: ${PAGE_W}mm; height: ${PAGE_H}mm; overflow: hidden; break-after: page; }
.group { position: absolute; left: ${MARGIN}mm; top: 1mm; font: 6pt Arial; color: #888; }
.cell { position: absolute; display: flex; flex-direction: column; justify-content: center; padding: 0.15mm 0.25mm; overflow: hidden; line-height: 1.05; font-family: 'Times New Roman', 'Liberation Serif', serif; word-break: normal; }
.pageno { position: absolute; right: ${MARGIN}mm; bottom: 1mm; font: 6pt Arial; color: #666; }
</style></head><body>${pages.join('')}</body></html>`;

mkdirSync(path.dirname(outPdf), { recursive: true });
writeFileSync(outPdf.replace(/\.pdf$/, '.html'), html, 'utf8');
const candidates = globSync('.playwright-browsers/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const executablePath = candidates[0];
if (!executablePath) throw new Error('Chromium headless shell not found under .playwright-browsers');
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({ path: outPdf, format: 'A4', landscape: true, printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
await browser.close();
console.log(outPdf);
console.log('pages', pages.length, 'scale', scale.toFixed(3));
