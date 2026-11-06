import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversionCacheService } from '../../src/conversions/conversion-cache.service';
import type { ConversionResult } from '../../src/conversions/conversion.types';
import type { AppConfig } from '../../src/config';

function cacheWith(overrides: { ttl?: number; maxBytes?: number } = {}) {
  const config = {
    cacheTtlSeconds: overrides.ttl ?? 900,
    cacheMaxBytes: overrides.maxBytes ?? 1024,
  } as unknown as AppConfig;
  return new ConversionCacheService(config);
}

function result(size: number, sha = 'a'.repeat(64)): ConversionResult {
  return {
    pdf: Buffer.alloc(size, 0x20),
    pdfSha256: sha,
    sourceSha256: 'b'.repeat(64),
    pageCount: 1,
    document: {
      family: 'Torg2',
      formatVersion: '5.01',
      operatorVersion: 'torg2_05_01_01',
      titleIndex: 0,
      function: null,
      workflowFunction: null,
      knd: '1175014',
    },
    validation: {
      xsd: 'valid',
      schemaRevision: 'test',
      schemaSha256: 'c'.repeat(64),
      businessRulesVersion: 'test',
      business: 'passed',
      unmappedCount: 0,
    },
    warnings: [],
    templateVersion: 'test',
    cacheHit: false,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ConversionCacheService', () => {
  it('returns entries until the TTL expires', () => {
    vi.useFakeTimers();
    const cache = cacheWith({ ttl: 2 });
    cache.set('key', result(10));
    expect(cache.get('key')?.result.pdf.length).toBe(10);

    vi.advanceTimersByTime(2_100);
    expect(cache.get('key')).toBeUndefined();
    expect(cache.stats().entries).toBe(0);
  });

  it('evicts the least recently used entry when the byte limit is exceeded', () => {
    const cache = cacheWith({ maxBytes: 10 });
    cache.set('first', result(6));
    cache.set('second', result(6));

    expect(cache.get('first')).toBeUndefined();
    expect(cache.get('second')).toBeDefined();
    expect(cache.stats().bytes).toBe(6);
  });

  it('refreshes recency on get', () => {
    const cache = cacheWith({ maxBytes: 12 });
    cache.set('first', result(6));
    cache.set('second', result(6));
    expect(cache.get('first')).toBeDefined();

    cache.set('third', result(6));
    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('first')).toBeDefined();
    expect(cache.get('third')).toBeDefined();
  });
});
