#!/usr/bin/env node
// Verifies that every pinned XSD still matches the checksum recorded in the
// manifest. Run before releasing an image: a mismatch means the schema revision
// changed and must be re-reviewed, not silently overwritten.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const manifestPath = path.resolve('resources/manifests/schemas.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

let failed = false;
for (const schema of manifest.schemas) {
  const file = path.resolve('resources/schemas', schema.file);
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  const ok = digest === schema.sha256;
  console.log(`${ok ? 'OK ' : 'BAD'} ${schema.id} ${digest}`);
  if (!ok) failed = true;
}
if (failed) {
  console.error('Schema checksum mismatch: the pinned revision was modified');
  process.exit(1);
}
console.log(`\n${manifest.schemas.length} pinned schemas verified`);
