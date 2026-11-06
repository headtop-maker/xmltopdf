import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { logger } from '../common/logger';

export interface XsdErrorDetail {
  readonly line?: number;
  readonly message: string;
}

export interface XsdValidationResult {
  readonly valid: boolean;
  readonly details: readonly XsdErrorDetail[];
  readonly truncated: boolean;
  readonly durationMs: number;
}

const STDERR_LIMIT = 64 * 1024;
const DETAIL_LIMIT = 50;

@Injectable()
export class XsdValidatorService implements OnModuleInit, OnModuleDestroy {
  private available = false;
  private tmpDir = '';

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    this.tmpDir = await mkdtemp(path.join(tmpdir(), 'xmltopdf-xsd-'));
    await this.probe();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.tmpDir) await rm(this.tmpDir, { recursive: true, force: true });
  }

  isAvailable(): boolean {
    return this.available;
  }

  private probe(): Promise<void> {
    return new Promise((resolve) => {
      const child = spawn('xmllint', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.on('error', () => {
        logger.warn('xsd.xmllint.missing', { message: 'xmllint is not available' });
        resolve();
      });
      child.on('close', () => {
        this.available = output.includes('libxml');
        if (!this.available) logger.warn('xsd.xmllint.unexpected', { message: 'xmllint probe failed' });
        resolve();
      });
    });
  }

  private async run(args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string; timedOut: boolean; truncated: boolean }> {
    return new Promise((resolve, reject) => {
      const child = spawn('xmllint', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', LANG: 'C', TZ: 'UTC' },
      });
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < STDERR_LIMIT) {
          stderr += chunk.toString('utf8');
          if (stderr.length > STDERR_LIMIT) {
            stderr = stderr.slice(0, STDERR_LIMIT);
            truncated = true;
          }
        } else {
          truncated = true;
        }
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stderr, timedOut, truncated });
      });
    });
  }

  async validate(schemaPath: string, xml: Buffer): Promise<XsdValidationResult> {
    if (!this.available) {
      throw new AppError(503, 'VALIDATION_UNAVAILABLE', 'The XSD validator is not available');
    }
    const started = Date.now();
    const tmpFile = path.join(this.tmpDir, `xml-${randomUUID()}.xml`);
    try {
      await writeFile(tmpFile, xml, { mode: 0o600 });
      const result = await this.run(
        ['--nonet', '--noout', '--schema', schemaPath, tmpFile],
        this.config.timeouts.xsdMs,
      );
      if (result.timedOut) {
        throw new AppError(504, 'CONVERSION_TIMEOUT', 'XSD validation exceeded its time budget');
      }
      if (result.code === 0) {
        return { valid: true, details: [], truncated: false, durationMs: Date.now() - started };
      }
      if (result.code === null || result.code > 4) {
        throw new AppError(503, 'VALIDATION_UNAVAILABLE', 'The XSD validator failed to run');
      }
      const details = this.parseDiagnostics(result.stderr, tmpFile);
      return {
        valid: false,
        details: details.slice(0, DETAIL_LIMIT),
        truncated: details.length > DETAIL_LIMIT || result.truncated,
        durationMs: Date.now() - started,
      };
    } finally {
      await rm(tmpFile, { force: true });
    }
  }

  private parseDiagnostics(stderr: string, tmpFile: string): XsdErrorDetail[] {
    const details: XsdErrorDetail[] = [];
    for (const rawLine of stderr.split('\n')) {
      const line = rawLine.trimEnd();
      if (!line || line === 'Schemas validity error :') continue;
      const sanitized = line.split(tmpFile).join('input.xml');
      const match = /^(?:input\.xml|.*?):(\d+):\s*(.*)$/.exec(sanitized);
      if (match) {
        details.push({
          line: Number(match[1]),
          message: match[2].replace(/^Schemas validity error :\s*/, '').replace(/^element /, '$&'),
        });
      } else if (!sanitized.startsWith('input.xml validates')) {
        details.push({ message: sanitized });
      }
    }
    return details;
  }
}
