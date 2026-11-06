import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config';
import type { ConversionResult } from './conversion.types';

interface CacheEntry {
  readonly id: string;
  readonly result: ConversionResult;
  readonly expiresAt: number;
  readonly bytes: number;
}

interface TokenEntry {
  readonly artifactId: string;
  readonly expiresAt: number;
}

export interface CachedConversion {
  readonly id: string;
  readonly result: ConversionResult;
}

export interface CacheStats {
  readonly entries: number;
  readonly tokens: number;
  readonly bytes: number;
  readonly ttlSeconds: number;
  readonly tokenTtlSeconds: number;
  readonly maxBytes: number;
}

/**
 * In-memory PDF cache and short-lived download tokens.
 *
 * No files and no database: the bytes live in this process only. A token is a
 * random capability that resolves to one cache entry; it dies with the process,
 * and a cache eviction makes the token invalid too.
 */
@Injectable()
export class ConversionCacheService {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly byId = new Map<string, CacheEntry>();
  private readonly tokens = new Map<string, TokenEntry>();
  private bytes = 0;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get(key: string): CachedConversion | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { id: entry.id, result: entry.result };
  }

  set(key: string, result: ConversionResult): string {
    this.delete(key);
    const entry: CacheEntry = {
      id: randomUUID(),
      result,
      expiresAt: Date.now() + this.config.cacheTtlSeconds * 1000,
      bytes: result.pdf.length,
    };
    this.entries.set(key, entry);
    this.byId.set(entry.id, entry);
    this.bytes += entry.bytes;
    this.evict();
    return entry.id;
  }

  issueToken(artifactId: string): { token: string; expiresAt: string } {
    const entry = this.byId.get(artifactId);
    if (!entry || entry.expiresAt <= Date.now()) {
      throw new Error('The artifact is no longer available');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Math.min(Date.now() + this.config.downloadTokenTtlSeconds * 1000, entry.expiresAt);
    this.tokens.set(token, { artifactId, expiresAt });
    this.purgeTokens();
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  resolveToken(token: string): CachedConversion | undefined {
    const record = this.tokens.get(token);
    if (!record) return undefined;
    if (record.expiresAt <= Date.now()) {
      this.tokens.delete(token);
      return undefined;
    }
    const entry = this.byId.get(record.artifactId);
    if (!entry) {
      this.tokens.delete(token);
      return undefined;
    }
    return { id: entry.id, result: entry.result };
  }

  stats(): CacheStats {
    this.purgeTokens();
    return {
      entries: this.entries.size,
      tokens: this.tokens.size,
      bytes: this.bytes,
      ttlSeconds: this.config.cacheTtlSeconds,
      tokenTtlSeconds: this.config.downloadTokenTtlSeconds,
      maxBytes: this.config.cacheMaxBytes,
    };
  }

  private delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.byId.delete(entry.id);
    for (const [token, record] of this.tokens) {
      if (record.artifactId === entry.id) this.tokens.delete(token);
    }
    this.bytes -= entry.bytes;
  }

  private purgeTokens(): void {
    const now = Date.now();
    for (const [token, record] of this.tokens) {
      if (record.expiresAt <= now || !this.byId.has(record.artifactId)) {
        this.tokens.delete(token);
      }
    }
  }

  private evict(): void {
    while (this.bytes > this.config.cacheMaxBytes && this.entries.size > 0) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}
