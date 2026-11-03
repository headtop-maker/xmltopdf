import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { DocumentRegistry } from '../document-registry/document-registry.service';
import { PdfRendererService } from '../rendering/pdf-renderer.service';
import { XsdValidatorService } from '../validation/xsd-validator.service';

export interface ReadinessReport {
  readonly status: 'ok' | 'unavailable';
  readonly version: string;
  readonly uptimeSeconds: number;
  readonly checks: Record<string, { ok: boolean; detail?: string }>;
}

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly artifacts: ArtifactsService,
    private readonly registry: DocumentRegistry,
    private readonly xsd: XsdValidatorService,
    private readonly renderer: PdfRendererService,
  ) {}

  async readiness(): Promise<ReadinessReport> {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    checks.storage = { ok: true };
    try {
      await this.artifacts.storageStats();
    } catch (error) {
      checks.storage = { ok: false, detail: (error as Error).message };
    }

    const schemas = this.registry.all();
    checks.schemas = {
      ok: schemas.length > 0 && schemas.every((descriptor) => this.registry.isSchemaVerified(descriptor)),
      detail: `${schemas.length} pinned schemas`,
    };

    checks.xsdValidator = {
      ok: this.xsd.isAvailable(),
      detail: this.xsd.isAvailable() ? 'xmllint present' : 'xmllint not found',
    };

    const renderer = this.renderer.snapshot();
    checks.renderer = {
      ok: renderer.ready,
      detail: `active=${renderer.active}, queued=${renderer.queued}`,
    };

    checks.fonts = {
      ok: this.renderer.fontStyles().includes('PT Sans'),
      detail: 'PT Sans embedded locally',
    };

    const ok = Object.values(checks).every((check) => check.ok);
    return {
      status: ok ? 'ok' : 'unavailable',
      version: this.config.appVersion,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      checks,
    };
  }
}
