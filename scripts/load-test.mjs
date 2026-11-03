#!/usr/bin/env node
// Synchronous-load measurement against a running instance.
// Usage: node scripts/load-test.mjs <fixture> <concurrency> <requests> [baseUrl]
import { readFileSync } from 'node:fs';

const [fixture, concurrencyRaw, requestsRaw, baseUrlArg] = process.argv.slice(2);
const concurrency = Number(concurrencyRaw ?? 1);
const requests = Number(requestsRaw ?? 10);
const baseUrl = baseUrlArg ?? process.env.BASE_URL ?? 'http://localhost:3000';
const apiKey = process.env.API_KEY ?? 'local-test-key';

if (!fixture || !Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(requests)) {
  console.error('usage: load-test.mjs <fixture> <concurrency> <requests> [baseUrl]');
  process.exit(1);
}
const body = readFileSync(fixture);

const latencies = [];
const statuses = new Map();
const errors = [];
let next = 0;
let peakRss = null;

async function sampleRss() {
  // Best-effort container/host RSS sample; never fails the run.
  try {
    const { execSync } = await import('node:child_process');
    const out = execSync(
      "docker stats --no-stream --format '{{.MemUsage}}' $(docker ps -q --filter name=xmltopdf-api-1) 2>/dev/null",
      { encoding: 'utf8' },
    ).trim();
    const match = /^([\d.]+)([KMG]i?B)/.exec(out);
    if (match) {
      const value = Number(match[1]) * ({ KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[match[2]] ?? 1);
      peakRss = Math.max(peakRss ?? 0, value);
    }
  } catch {
    /* ignore */
  }
}

async function one() {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/v1/conversions`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/octet-stream',
        Accept: 'application/json',
      },
      body,
    });
    const text = await response.text();
    const elapsed = performance.now() - started;
    latencies.push(elapsed);
    statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
    if (!response.ok) errors.push({ status: response.status, body: text.slice(0, 300) });
    return { ok: response.ok, elapsed };
  } catch (error) {
    latencies.push(performance.now() - started);
    statuses.set('network', (statuses.get('network') ?? 0) + 1);
    errors.push({ status: 'network', body: String(error) });
    return { ok: false };
  }
}

async function worker() {
  while (true) {
    const index = next;
    next += 1;
    if (index >= requests) return;
    await one();
    if (index % 5 === 0) await sampleRss();
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, () => worker()));
const totalMs = performance.now() - startedAt;
await sampleRss();

const sorted = [...latencies].sort((a, b) => a - b);
const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
const result = {
  fixture,
  bytes: body.length,
  concurrency,
  requests,
  totalMs: Math.round(totalMs),
  throughputPerSecond: Number((requests / (totalMs / 1000)).toFixed(2)),
  statuses: Object.fromEntries(statuses),
  errors: errors.slice(0, 5),
  latencyMs: {
    p50: Math.round(percentile(50)),
    p95: Math.round(percentile(95)),
    p99: Math.round(percentile(99)),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
    mean: Math.round(sorted.reduce((sum, value) => sum + value, 0) / (sorted.length || 1)),
  },
  peakRssMiB: peakRss ? Math.round(peakRss / 1024 / 1024) : null,
};
console.log(JSON.stringify(result, null, 2));
if ([...statuses.keys()].some((status) => status !== 201)) process.exitCode = 1;
