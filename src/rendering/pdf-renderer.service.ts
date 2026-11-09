import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { APP_CONFIG, type AppConfig } from '../config';
import { AppError, errors, isAppError } from '../common/errors';
import { logger } from '../common/logger';

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

export interface RenderOptions {
  readonly sourceSha256: string;
  readonly documentLabel: string;
  /** Technical source hash in the page footer; off by default. */
  readonly showSourceHash?: boolean;
  /** Page numbering footer; TORG-2 matches the approved blank without it. */
  readonly showPageNumber?: boolean;
  /** Left part of the footer, e.g. the document name and number. */
  readonly footerLabel?: string;
}

/**
 * Serialises PDF rendering through a bounded pool and guarantees a single
 * Chromium instance. The browser context has JavaScript disabled, works
 * offline and aborts every non-data request, so a document cannot trigger
 * network access, service workers or external resource loads.
 */
@Injectable()
export class PdfRendererService implements OnModuleInit, OnModuleDestroy {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private active = 0;
  private readonly queue: Waiter[] = [];
  private fontCss = '';
  private readonly stats = { rendered: 0, failed: 0, restarts: 0, queued: 0 };

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    await this.loadFonts();
    try {
      await this.ensureBrowser();
      logger.info('renderer.ready', { browser: this.config.rendererVersion });
    } catch (error) {
      logger.error('renderer.unavailable', { message: (error as Error).message });
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const waiter of this.queue.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(errors.rendererBusy(1));
    }
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }

  isReady(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  snapshot(): { ready: boolean; active: number; queued: number; rendered: number; failed: number; restarts: number } {
    return {
      ready: this.isReady(),
      active: this.active,
      queued: this.queue.length,
      rendered: this.stats.rendered,
      failed: this.stats.failed,
      restarts: this.stats.restarts,
    };
  }

  private async loadFonts(): Promise<void> {
    const regular = await readFile(path.join(this.config.fontsDir, 'PT_Sans-Web-Regular.ttf'));
    const bold = await readFile(path.join(this.config.fontsDir, 'PT_Sans-Web-Bold.ttf'));
    const italic = await readFile(path.join(this.config.fontsDir, 'PT_Sans-Web-Italic.ttf'));
    const face = (weight: string, style: string, data: Buffer): string =>
      `@font-face { font-family: 'PT Sans'; font-style: ${style}; font-weight: ${weight}; src: url(data:font/ttf;base64,${data.toString('base64')}) format('truetype'); }`;
    this.fontCss = [face('normal', 'normal', regular), face('bold', 'normal', bold), face('normal', 'italic', italic)].join('\n');
  }

  fontStyles(): string {
    return this.fontCss;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    if (this.launching) return this.launching;
    this.launching = chromium
      .launch({
        headless: true,
        executablePath: this.config.renderer.browserPath,
        args: [
          '--disable-dev-shm-usage',
          '--disable-background-networking',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-sync',
          '--metrics-recording-only',
          '--no-first-run',
          '--no-default-browser-check',
          '--host-resolver-rules=MAP * ~NOTFOUND',
        ],
      })
      .then((browser) => {
        this.browser = browser;
        browser.on('disconnected', () => {
          if (this.browser === browser) {
            this.browser = null;
            this.stats.restarts += 1;
            logger.warn('renderer.disconnected', {});
          }
        });
        return browser;
      })
      .finally(() => {
        this.launching = null;
      });
    return this.launching;
  }

  private acquire(): Promise<void> {
    if (this.active < this.config.renderer.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.queue.length >= this.config.renderer.queueLimit) {
      throw errors.rendererBusy(5);
    }
    return new Promise<void>((resolve, reject) => {
      let waiter: Waiter;
      const timer = setTimeout(() => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        reject(errors.rendererBusy(5));
      }, this.config.timeouts.conversionMs);
      waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject,
        timer,
      };
      this.queue.push(waiter);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next.resolve();
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  }

  async render(html: string, options: RenderOptions): Promise<Buffer> {
    await this.acquire();
    let context: BrowserContext | undefined;
    try {
      const browser = await this.ensureBrowser();
      context = await browser.newContext({
        javaScriptEnabled: false,
        serviceWorkers: 'block',
        offline: true,
        locale: 'ru-RU',
        viewport: { width: 1400, height: 900 },
      });
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith('data:') || url.startsWith('about:')) return route.continue();
        return route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(this.config.timeouts.renderMs);
      await page.setContent(html, { waitUntil: 'load', timeout: this.config.timeouts.renderMs });
      await page.evaluate(() => {
        const globalDocument = (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document;
        return globalDocument.fonts.ready;
      });

      const hash = options.showSourceHash
        ? `<span>&middot; SHA-256 ${options.sourceSha256.slice(0, 16)}</span>`
        : '';
      const footer = `<div style="width:100%;padding:0 10mm;font-family:'DejaVu Sans',Arial,sans-serif;font-size:7.5px;color:#444;">
        <div style="display:flex;justify-content:space-between;gap:6px;">
          <span>${options.footerLabel ?? ''}</span>
          <span>${hash} Страница <span class="pageNumber"></span> из <span class="totalPages"></span></span>
        </div>
      </div>`;

      const pdf = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: options.showPageNumber !== false,
        headerTemplate: '<div></div>',
        footerTemplate: footer,
        margin: { top: '9mm', right: '10mm', bottom: '14mm', left: '10mm' },
      });
      this.stats.rendered += 1;
      return Buffer.from(pdf);
    } catch (error) {
      this.stats.failed += 1;
      logger.error('renderer.failed', {
        message: (error as Error).message,
        name: error instanceof Error ? error.name : typeof error,
      });
      if (isAppError(error)) throw error;
      if (error instanceof Error && error.name === 'TimeoutError') throw errors.timeout();
      throw new AppError(503, 'RENDERER_UNAVAILABLE', 'The PDF renderer failed to produce a document', {
        cause: error,
      });
    } finally {
      await context?.close().catch(() => undefined);
      this.release();
    }
  }
}
