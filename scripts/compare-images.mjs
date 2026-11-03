#!/usr/bin/env node
// Compares rendered page PNGs with approved goldens.
// Usage: node scripts/compare-images.mjs <goldenDir> <actualDir> [maxRatio]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import pngjs from 'pngjs';
import pixelmatch from 'pixelmatch';

const { PNG } = pngjs;
const [goldenRoot, actualRoot, maxRatioRaw] = process.argv.slice(2);
const maxRatio = Number(maxRatioRaw ?? 0.002);

if (!goldenRoot || !actualRoot) {
  console.error('usage: compare-images.mjs <goldenDir> <actualDir> [maxRatio]');
  process.exit(1);
}
if (!existsSync(goldenRoot)) {
  console.error(`golden directory not found: ${goldenRoot}`);
  process.exit(1);
}

const diffRoot = path.join(path.dirname(actualRoot), 'diff');
mkdirSync(diffRoot, { recursive: true });

const fixtures = readdirSync(goldenRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const results = [];
let failed = false;

for (const fixture of fixtures) {
  const expectedDir = path.join(goldenRoot, fixture);
  const actualDir = path.join(actualRoot, fixture);
  const expectedPages = readdirSync(expectedDir).filter((file) => file.endsWith('.png')).sort();
  const actualPages = existsSync(actualDir)
    ? readdirSync(actualDir).filter((file) => file.endsWith('.png')).sort()
    : [];

  if (actualPages.length !== expectedPages.length) {
    results.push({
      fixture,
      ok: false,
      reason: `page count differs: expected ${expectedPages.length}, got ${actualPages.length}`,
    });
    failed = true;
    continue;
  }

  for (const page of expectedPages) {
    const expected = PNG.sync.read(readFileSync(path.join(expectedDir, page)));
    const actual = PNG.sync.read(readFileSync(path.join(actualDir, page)));
    if (expected.width !== actual.width || expected.height !== actual.height) {
      results.push({
        fixture,
        page,
        ok: false,
        reason: `size differs: ${expected.width}x${expected.height} vs ${actual.width}x${actual.height}`,
      });
      failed = true;
      continue;
    }
    const diff = new PNG({ width: expected.width, height: expected.height });
    const mismatched = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, {
      threshold: 0.15,
      includeAA: false,
    });
    const ratio = mismatched / (expected.width * expected.height);
    const ok = ratio <= maxRatio;
    if (!ok) {
      failed = true;
      mkdirSync(path.join(diffRoot, fixture), { recursive: true });
      writeFileSync(path.join(diffRoot, fixture, page), PNG.sync.write(diff));
    }
    results.push({
      fixture,
      page,
      ok,
      mismatchedPixels: mismatched,
      ratio: Number(ratio.toFixed(6)),
    });
  }
}

console.log(JSON.stringify({ maxRatio, results }, null, 2));
if (failed) {
  console.error(`\nvisual regression failed; diff images: ${diffRoot}`);
  process.exit(1);
}
console.log(`\nvisual regression passed: ${results.length} page(s)`);
