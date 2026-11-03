#!/usr/bin/env node
// Semantic acceptance check for the TORG-2 sample against the values pinned in
// the specification (section 2.3). Uses pdftotext output of the generated PDF.
import { readFileSync } from 'node:fs';

const textPath = process.argv[2] ?? 'test-output/generated.txt';
const raw = readFileSync(textPath, 'utf8');
const text = raw.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n');

const checks = [];
const check = (name, condition, detail = '') => checks.push({ name, ok: Boolean(condition), detail });

const flat = text.replace(/\n/g, ' ').replace(/ +/g, ' ');

check('номер акта', flat.includes('УПД-ЭТрН-001'));
check('дата акта 02.11.2026', flat.includes('02.11.2026'));
check('дата сопроводительного документа 24.09.2026', flat.includes('24.09.2026'));
check('дата осмотра', /Дата осмотра 02\.11\.2026/.test(flat));
check('наименование товара', flat.includes('Мука пшеничная хлебопекарная'));
check('единица измерения Килограмм', flat.includes('Килограмм'));
check('код ОКЕИ 166', flat.includes('166'));
check('поставщик', flat.includes('ТОРГОВЫЙ ДОМ ФЛАГМАН'));
check('покупатель', flat.includes('ООО "ФЛАГМАН"'));
check('ИНН поставщика', flat.includes('6162092687'));
check('ИНН покупателя', flat.includes('6163106798'));

const goodsRow = '1 000 45,00 49 500,00 10% 950 45,00 47 025,00 10%';
check('строка товара: документы и факт в правильном порядке', flat.includes(goodsRow), goodsRow);
const lines = text.split('\n');
const rowIndex = lines.findIndex((line) => line.includes('Мука пшеничная'));
const rowBlock = lines.slice(rowIndex, rowIndex + 3).join(' ');
check('НДС строки привязан к своей ячейке', rowBlock.includes('4 500,00') && rowBlock.includes('4 275,00'), rowBlock.trim());

check('недостача: количество 50', /Недостача[\s\S]{0,400}?50 2 475,00 225,00/.test(text));
check('недостача: сумма с НДС 2 475,00', flat.includes('2 475,00'));
check('недостача: НДС 225,00', flat.includes('225,00'));
check('излишки: явный ноль', /Излишки[\s\S]{0,600}?\b0\b/.test(text));
check('ФИО подписанта', flat.includes('СУХОМЛИНОВ СЕРГЕЙ ПЕТРОВИЧ'));
check('должность подписанта', flat.includes('ГЕНЕРАЛЬНЫЙ ДИРЕКТОР'));
check('дисклеймер о непроверенной подписи', flat.includes('Подпись не проверялась'));
check('источник XML по SHA-256', flat.includes('3e3edc1fb6e31dbd'));
check('дополнительные сведения (ИнфДопСв=1)', /дополнительные сведения к документу сформированы/.test(flat));

const failed = checks.filter((item) => !item.ok);
for (const item of checks) {
  console.log(`${item.ok ? 'OK  ' : 'FAIL'} ${item.name}${item.detail ? ` [${item.detail}]` : ''}`);
}
if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nall ${checks.length} semantic checks passed`);
