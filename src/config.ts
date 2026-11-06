import 'dotenv/config';
import * as path from 'node:path';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface ApiKeyRecord {
  readonly key: string;
  readonly ownerId: string;
}

export interface AppConfig {
  readonly env: string;
  readonly port: number;
  readonly publicBaseUrl: string;
  readonly apiKeys: ReadonlyMap<string, ApiKeyRecord>;
  readonly docsEnabled: boolean;
  readonly resourceDir: string;
  readonly schemasDir: string;
  readonly manifestsDir: string;
  readonly dictionariesDir: string;
  readonly fontsDir: string;
  readonly templatesDir: string;
  readonly cacheTtlSeconds: number;
  readonly cacheMaxBytes: number;
  readonly downloadTokenTtlSeconds: number;
  readonly rateLimitPerMinute: number;
  readonly limits: {
    readonly maxBodyBytes: number;
    readonly maxDecodedBytes: number;
    readonly maxElements: number;
    readonly maxDepth: number;
    readonly maxValueChars: number;
    readonly maxGoodsRows: number;
    readonly maxPdfPages: number;
    readonly maxPdfBytes: number;
  };
  readonly timeouts: {
    readonly conversionMs: number;
    readonly xsdMs: number;
    readonly renderMs: number;
  };
  readonly renderer: {
    readonly maxConcurrent: number;
    readonly queueLimit: number;
    readonly browserPath?: string;
  };
  readonly vislib: {
    readonly enabled: boolean;
    readonly jar?: string;
    readonly templatesDir?: string;
    readonly javaPath: string;
    readonly timeoutMs: number;
  };
  readonly appVersion: string;
  readonly rendererVersion: string;
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function readBool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function parseApiKeys(raw: string | undefined): Map<string, ApiKeyRecord> {
  const map = new Map<string, ApiKeyRecord>();
  if (!raw) return map;
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(':');
    if (separator <= 0) {
      throw new Error('API_KEYS entries must look like "<key>:<ownerId>"');
    }
    const key = trimmed.slice(0, separator).trim();
    const ownerId = trimmed.slice(separator + 1).trim();
    if (!key || !ownerId) {
      throw new Error('API_KEYS entries must look like "<key>:<ownerId>"');
    }
    map.set(key, { key, ownerId });
  }
  return map;
}

function resolveFromCwd(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const resourceDir = resolveFromCwd(env.RESOURCE_DIR ?? './resources');
  const apiKeys = parseApiKeys(env.API_KEYS);
  if (apiKeys.size === 0) {
    throw new Error(
      'API_KEYS is required (for example "<key>:<ownerId>"). ' +
        'The service never starts without authentication configured.',
    );
  }

  const publicBaseUrl = env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
  let parsedBase: URL;
  try {
    parsedBase = new URL(publicBaseUrl);
  } catch {
    throw new Error(`PUBLIC_BASE_URL is not a valid absolute URL: "${publicBaseUrl}"`);
  }
  if (!['http:', 'https:'].includes(parsedBase.protocol)) {
    throw new Error('PUBLIC_BASE_URL must use http or https');
  }

  return {
    env: nodeEnv,
    port: readInt(env, 'PORT', 3000),
    publicBaseUrl: parsedBase.toString().replace(/\/$/, ''),
    apiKeys,
    docsEnabled: readBool(env, 'DOCS_ENABLED', nodeEnv !== 'production'),
    resourceDir,
    schemasDir: path.join(resourceDir, 'schemas'),
    manifestsDir: path.join(resourceDir, 'manifests'),
    dictionariesDir: path.join(resourceDir, 'dictionaries'),
    fontsDir: path.join(resourceDir, 'fonts'),
    templatesDir: path.join(resourceDir, 'templates'),
    cacheTtlSeconds: readInt(env, 'CACHE_TTL_SECONDS', 900),
    cacheMaxBytes: readInt(env, 'CACHE_MAX_BYTES', 64 * 1024 * 1024),
    downloadTokenTtlSeconds: readInt(env, 'DOWNLOAD_TOKEN_TTL_SECONDS', 900),
    rateLimitPerMinute: Math.max(0, Number(env.RATE_LIMIT_PER_MINUTE ?? '300') || 0),
    limits: {
      maxBodyBytes: readInt(env, 'MAX_BODY_BYTES', 10 * 1024 * 1024),
      maxDecodedBytes: readInt(env, 'MAX_DECODED_BYTES', 30 * 1024 * 1024),
      maxElements: readInt(env, 'MAX_XML_ELEMENTS', 100_000),
      maxDepth: readInt(env, 'MAX_XML_DEPTH', 64),
      maxValueChars: readInt(env, 'MAX_XML_VALUE_CHARS', 100_000),
      maxGoodsRows: readInt(env, 'MAX_GOODS_ROWS', 1000),
      maxPdfPages: readInt(env, 'MAX_PDF_PAGES', 100),
      maxPdfBytes: readInt(env, 'MAX_PDF_BYTES', 50 * 1024 * 1024),
    },
    timeouts: {
      conversionMs: readInt(env, 'CONVERSION_TIMEOUT_MS', 30_000),
      xsdMs: readInt(env, 'XSD_TIMEOUT_MS', 10_000),
      renderMs: readInt(env, 'RENDER_TIMEOUT_MS', 20_000),
    },
    renderer: {
      maxConcurrent: readInt(env, 'MAX_CONCURRENT_RENDERS', 2),
      queueLimit: readInt(env, 'RENDER_QUEUE_LIMIT', 10),
      browserPath: env.CHROMIUM_EXECUTABLE_PATH || undefined,
    },
    vislib: {
      enabled: readBool(env, 'VISLIB_ENABLED', false),
      jar: env.VISLIB_JAR ? resolveFromCwd(env.VISLIB_JAR) : undefined,
      templatesDir: env.VISLIB_TEMPLATES_DIR ? resolveFromCwd(env.VISLIB_TEMPLATES_DIR) : undefined,
      javaPath: env.VISLIB_JAVA_PATH || 'java',
      timeoutMs: readInt(env, 'VISLIB_TIMEOUT_MS', 30_000),
    },
    appVersion: env.APP_VERSION ?? '0.1.0',
    rendererVersion: env.RENDERER_VERSION ?? 'chromium-playwright',
  };
}
