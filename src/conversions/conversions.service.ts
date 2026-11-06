import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { AppError, errors } from '../common/errors';
import { sha256Hex } from '../common/hash';
import { logger } from '../common/logger';
import {
  DocumentRegistry,
  extractMetadata,
  type SchemaDescriptor,
  type XmlMetadata,
} from '../document-registry/document-registry.service';
import { DocumentAdaptersService } from '../documents/document-adapters.service';
import { OwnerQuotaService } from '../access/owner-quota.service';
import type { PrintAdapter } from '../documents/adapter';
import { PdfInspectorService } from '../rendering/pdf-inspector.service';
import { PdfNormalizerService } from '../rendering/pdf-normalizer.service';
import { XsdValidatorService } from '../validation/xsd-validator.service';
import { decodeXmlBytes, type DecodedXml } from '../xml-security/encoding';
import { XmlParserService } from '../xml-security/xml-parser.service';
import type { ParsedXml } from '../xml-security/xml-tree';
import { ConversionCacheService } from './conversion-cache.service';
import { ConversionResponseDto } from './conversions.dto';
import type { ConversionResult } from './conversion.types';

export const RENDER_PROFILE = 'chromium-pdf-a4-landscape-v1';

const ALLOWED_MEDIA_TYPES = new Set(['application/octet-stream', 'application/xml', 'text/xml']);

export interface ConvertInput {
  readonly ownerId: string;
  readonly body: unknown;
  readonly contentType: string | undefined;
}

interface Prepared {
  readonly ownerId: string;
  readonly raw: Buffer;
  readonly decoded: DecodedXml;
  readonly parsed: ParsedXml;
  readonly metadata: XmlMetadata;
  readonly descriptor: SchemaDescriptor;
  readonly adapter: PrintAdapter;
  readonly fingerprint: string;
  readonly startedAt: number;
}

@Injectable()
export class ConversionsService {
  private readonly inFlight = new Map<string, { promise: Promise<ConversionResult> }>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly parser: XmlParserService,
    private readonly registry: DocumentRegistry,
    private readonly xsd: XsdValidatorService,
    private readonly adapters: DocumentAdaptersService,
    private readonly inspector: PdfInspectorService,
    private readonly normalizer: PdfNormalizerService,
    private readonly quota: OwnerQuotaService,
    private readonly cache: ConversionCacheService,
  ) {}

  async convert(input: ConvertInput): Promise<ConversionResponseDto> {
    const startedAt = Date.now();
    const quota = this.quota.consume(input.ownerId);
    if (!quota.allowed) throw OwnerQuotaService.error(quota.retryAfterSeconds);
    const mediaType = (input.contentType ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
      throw errors.unsupportedMedia();
    }
    if (!Buffer.isBuffer(input.body)) {
      throw errors.emptyBody();
    }
    if (input.body.length === 0) {
      throw errors.emptyBody();
    }
    if (input.body.length > this.config.limits.maxBodyBytes) {
      throw errors.limit(`The request body exceeds ${this.config.limits.maxBodyBytes} bytes`);
    }

    const decoded = decodeXmlBytes(input.body, this.config.limits.maxDecodedBytes);
    const parsed = this.parser.parse(decoded.text);
    let goodsRows = 0;
    parsed.root.walk((node) => {
      if (node.name === 'РезПрием') goodsRows += 1;
    });
    if (goodsRows > this.config.limits.maxGoodsRows) {
      throw errors.limit(
        `The document declares ${goodsRows} goods rows; the limit is ${this.config.limits.maxGoodsRows}`,
      );
    }

    const metadata = extractMetadata(parsed);
    const descriptor = this.registry.detect(metadata);
    const adapter = this.adapters.get(descriptor);

    const sourceSha256 = sha256Hex(input.body);
    const sabyLayout =
      descriptor.id === 'utd970_05_03_01_title0' &&
      process.env.UPD_SABY_LAYOUT === 'true' &&
      (metadata.documentFunction === 'СЧФДОП' || metadata.documentFunction === 'ДОП');
    const layoutVariant = sabyLayout ? 'upd-saby-draft' : 'default';
    const fingerprint = sha256Hex(
      [
        sourceSha256,
        descriptor.id,
        adapter.templateVersion,
        layoutVariant,
        RENDER_PROFILE,
        this.config.appVersion,
      ].join('|'),
    );
    // Identical bytes and print parameters reuse the same entry; no header is required.
    const cacheKey = `${input.ownerId}:content:${fingerprint}`;

    let result: ConversionResult;
    let artifactId: string;
    let cached = false;

    const entry = this.cache.get(cacheKey);
    if (entry) {
      result = entry.result;
      artifactId = entry.id;
      cached = true;
    } else {
      const pending = this.inFlight.get(cacheKey);
      if (pending) {
        result = await pending.promise;
        const stored = this.cache.get(cacheKey);
        if (!stored) throw new AppError(500, 'CONVERSION_FAILED', 'The cached PDF disappeared before it was linked');
        artifactId = stored.id;
        cached = true;
      } else {
        const prepared: Prepared = {
          ownerId: input.ownerId,
          raw: input.body,
          decoded,
          parsed,
          metadata,
          descriptor,
          adapter,
          fingerprint,
          startedAt,
        };
        const work = this.runConversion(prepared);
        this.inFlight.set(cacheKey, { promise: work });
        const cleanup = (): void => {
          this.inFlight.delete(cacheKey);
        };
        void work.then(cleanup, cleanup);
        result = await work;
        artifactId = this.cache.set(cacheKey, result);
      }
    }

    const link = this.cache.issueToken(artifactId);
    return this.buildResponse(artifactId, result, link, cached);
  }

  download(token: string): { artifactId: string; result: ConversionResult } {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
      throw errors.notFound('Download link is invalid');
    }
    const resolved = this.cache.resolveToken(token);
    if (!resolved) throw errors.notFound('Download link is invalid');
    return { artifactId: resolved.id, result: resolved.result };
  }

  private buildResponse(
    artifactId: string,
    result: ConversionResult,
    link: { token: string; expiresAt: string },
    cached: boolean,
  ): ConversionResponseDto {
    return {
      artifactId,
      status: 'ready',
      document: result.document,
      validation: result.validation,
      sourceSha256: result.sourceSha256,
      pdfSha256: result.pdfSha256,
      pdfSizeBytes: result.pdf.length,
      pageCount: result.pageCount,
      templateVersion: result.templateVersion,
      signingTarget: 'pdf',
      signatureProfile: 'external-detached',
      signatureStatus: 'not-provided',
      downloadUrl: `${this.config.publicBaseUrl}/api/v1/downloads/${link.token}`,
      createdAt: new Date().toISOString(),
      expiresAt: link.expiresAt,
      warnings: result.warnings.map((warning) => ({ ...warning })),
      cached,
    };
  }

  private async runConversion(prepared: Prepared): Promise<ConversionResult> {
    const deadline = prepared.startedAt + this.config.timeouts.conversionMs;
    const checkDeadline = (): void => {
      if (Date.now() > deadline) throw errors.timeout();
    };

    const schemaPath = this.registry.schemaPath(prepared.descriptor);
    const xsdResult = await this.xsd.validate(schemaPath, prepared.raw);
    checkDeadline();
    if (!xsdResult.valid) {
      throw new AppError(
        422,
        'XSD_VALIDATION_FAILED',
        `The XML does not match ${prepared.descriptor.schemaRevision}`,
        {
          details: xsdResult.details.map((detail) => ({ line: detail.line, message: detail.message })),
          detailsTruncated: xsdResult.truncated,
        },
      );
    }

    const business = prepared.adapter.validateBusiness(prepared.parsed);
    if (business.status === 'failed') {
      throw new AppError(422, 'BUSINESS_VALIDATION_FAILED', 'The document failed business validation', {
        details: business.issues.map((issue) => ({
          path: issue.path,
          message: `${issue.code}: ${issue.message}`,
        })),
      });
    }

    const mapped = prepared.adapter.map(prepared.parsed, {
      sourceSha256: sha256Hex(prepared.raw),
      metadata: prepared.metadata,
    });
    if (mapped.coverage.unmapped > 0) {
      throw errors.unmapped('Some source values could not be represented', []);
    }

    checkDeadline();
    const rendered = prepared.adapter.renderSource
      ? await prepared.adapter.renderSource(prepared.raw, mapped.model)
      : await prepared.adapter.render(mapped.model);
    checkDeadline();
    const pdf = await this.normalizer.normalize(rendered);
    checkDeadline();

    const inspection = await this.inspector.inspect(pdf);
    if (inspection.pageCount > this.config.limits.maxPdfPages) {
      throw new AppError(
        422,
        'PDF_PAGE_LIMIT_EXCEEDED',
        `The rendered document has ${inspection.pageCount} pages; the limit is ${this.config.limits.maxPdfPages}`,
      );
    }
    if (pdf.length > this.config.limits.maxPdfBytes) {
      throw new AppError(422, 'UNRENDERABLE_CONTENT', 'The rendered PDF exceeds the configured size limit');
    }
    if (inspection.hasEncryption || inspection.hasActiveContent || inspection.hasEmbeddedFiles) {
      throw new AppError(500, 'CONVERSION_FAILED', 'The renderer produced a PDF with forbidden features');
    }

    const businessStatus = business.status === 'passed-with-warnings' ? 'passed-with-warnings' : 'passed';
    const warnings = [
      ...business.issues.map((issue) => ({ code: issue.code, message: issue.message, path: issue.path })),
      ...mapped.warnings,
    ];
    const pdfSha256 = sha256Hex(pdf);

    logger.info('conversion.completed', {
      family: prepared.descriptor.family,
      schemaRevision: prepared.descriptor.schemaRevision,
      xsdMs: xsdResult.durationMs,
      totalMs: Date.now() - prepared.startedAt,
      pdfBytes: pdf.length,
      pages: inspection.pageCount,
      unmapped: mapped.coverage.unmapped,
    });

    return {
      pdf,
      pdfSha256,
      sourceSha256: sha256Hex(prepared.raw),
      pageCount: inspection.pageCount,
      document: prepared.adapter.documentFor(prepared.metadata),
      validation: {
        xsd: 'valid',
        schemaRevision: prepared.descriptor.schemaRevision,
        schemaSha256: prepared.descriptor.schemaSha256,
        businessRulesVersion: prepared.adapter.businessRulesVersion,
        business: businessStatus,
        unmappedCount: mapped.coverage.unmapped,
      },
      warnings,
      templateVersion: prepared.adapter.templateVersion,
      cacheHit: false,
    };
  }
}
