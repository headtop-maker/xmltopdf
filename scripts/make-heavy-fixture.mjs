#!/usr/bin/env node
// Generates a heavy but schema-valid UPD fixture by duplicating goods rows.
// Usage: node scripts/make-heavy-fixture.mjs <rows> [out.xml]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const rows = Number(process.argv[2] ?? 100);
const out = process.argv[3] ?? `test-output/heavy/upd-${rows}-rows.xml`;
if (!Number.isInteger(rows) || rows < 1 || rows > 1000) {
  console.error('rows must be an integer between 1 and 1000');
  process.exit(1);
}

const base = readFileSync('test/fixtures/upd-schfdop.xml', 'utf8');

function money(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

let totalBase = 0;
let totalVat = 0;
let totalWithVat = 0;
let totalQty = 0;
const items = [];

for (let i = 1; i <= rows; i += 1) {
  const quantity = 1000 + i;
  const priceCents = 4500;
  const baseCents = quantity * priceCents;
  const vatCents = Math.round(baseCents * 0.1);
  totalBase += baseCents;
  totalVat += vatCents;
  totalWithVat += baseCents + vatCents;
  totalQty += quantity;
  items.push(
    `      <СведТов НомСтр="${i}" НаимТов="Товар синтетический ${i}" ОКЕИ_Тов="166" НаимЕдИзм="кг" ` +
      `КолТов="${quantity}" ЦенаТов="${money(priceCents)}" СтТовБезНДС="${money(baseCents)}" НалСт="10%" ` +
      `СтТовУчНал="${money(baseCents + vatCents)}">\n` +
      `\t\t\t\t<Акциз><БезАкциз>без акциза</БезАкциз></Акциз>\n` +
      `\t\t\t\t<СумНал><СумНал>${money(vatCents)}</СумНал></СумНал>\n` +
      `\t\t\t</СведТов>`,
  );
}

const firstRow = base.indexOf('<СведТов');
const totalsTag = base.indexOf('<ВсегоОпл');
if (firstRow < 0 || totalsTag < 0) {
  console.error('UPD fixture structure changed; cannot generate heavy fixture');
  process.exit(1);
}
let xml = base.slice(0, firstRow) + `${items.join('\n')}\n` + base.slice(totalsTag);
xml = xml.replace(
  /<ВсегоОпл[^>]*>/,
  `<ВсегоОпл СтТовБезНДСВсего="${money(totalBase)}" СтТовУчНалВсего="${money(totalWithVat)}" КолНеттоВс="${totalQty}">`,
);
xml = xml.replace(/<СумНалВсего>\s*<СумНал>[^<]*<\/СумНал>/, `<СумНалВсего><СумНал>${money(totalVat)}</СумНал>`);

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, xml);
console.log(JSON.stringify({ out, rows, bytes: Buffer.byteLength(xml), totalWithVat: money(totalWithVat) }));
