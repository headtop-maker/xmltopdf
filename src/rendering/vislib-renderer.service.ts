import { Inject, Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config';
import { AppError, errors } from '../common/errors';
import { logger } from '../common/logger';

/**
 * Optional adapter for the operator-supplied FNS visualization library.
 *
 * The library, its templates and the Java runtime are NOT bundled with this
 * service. When VISLIB_ENABLED=true and the paths are configured, TORG-2 is
 * rendered by the library instead of the built-in HTML renderer. This keeps
 * the default path dependency-free and lets installations with a license use
 * the approved template renderer.
 */
@Injectable()
export class VislibRendererService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return Boolean(
      this.config.vislib.enabled &&
        this.config.vislib.jar &&
        this.config.vislib.templatesDir,
    );
  }

  get version(): string {
    return this.enabled ? 'vislib-external' : 'disabled';
  }

  async render(source: Buffer): Promise<Buffer> {
    if (!this.enabled) {
      throw new AppError(500, 'RENDERER_UNAVAILABLE', 'The external visualization renderer is not configured');
    }
    const jar = this.config.vislib.jar!;
    const templates = this.config.vislib.templatesDir!;
    const work = await mkdtemp(path.join(tmpdir(), 'vislib-'));
    const outputDir = path.join(work, 'out');
    const sourcePath = path.join(work, 'source.xml');
    try {
      await mkdir(outputDir, { recursive: true });
      await writeFile(sourcePath, source);
      const result = await this.run(jar, templates, outputDir, sourcePath);
      const entries = await readdir(outputDir);
      const pdfName = entries.find((entry) => entry.toLowerCase().endsWith('.pdf'));
      if (!pdfName) {
        throw new AppError(500, 'CONVERSION_FAILED', 'The external renderer produced no PDF', {
          details: [{ message: result.stderr.slice(-2000) }],
        });
      }
      const pdf = await readFile(path.join(outputDir, pdfName));
      if (pdf.length === 0) {
        throw new AppError(500, 'CONVERSION_FAILED', 'The external renderer produced an empty PDF');
      }
      logger.info('renderer.vislib.completed', { bytes: pdf.length, code: result.code });
      return pdf;
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private run(
    jar: string,
    templates: string,
    outputDir: string,
    sourcePath: string,
  ): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.config.vislib.javaPath,
        ['-jar', jar, templates, outputDir, sourcePath],
        { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
      );
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new AppError(504, 'RENDER_TIMEOUT', 'The external renderer timed out'));
      }, this.config.vislib.timeoutMs);
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-8000);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new AppError(500, 'RENDERER_UNAVAILABLE', `Cannot start the external renderer: ${error.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new AppError(500, 'CONVERSION_FAILED', 'The external renderer exited with an error', {
              details: [{ message: stderr.slice(-2000) }],
            }),
          );
          return;
        }
        resolve({ code, stderr });
      });
    });
  }
}
