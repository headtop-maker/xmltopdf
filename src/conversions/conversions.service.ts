import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { AppError, errors } from '../common/errors';
import { sha256Hex } from '../common/hash';
import { logger } from '../common/logger';
import { ArtifactsService } from '../artifacts/artifacts.service';
import type { Artifact } from '../artifacts/artifact.types';
import {
  DocumentRegistry,
  extractMetadata,
  type DocumentTypeHint,
  type SchemaDescriptor,
  type XmlMetadata,
} from '../document-registry/document-registry.service';
import { DocumentAdaptersService } from '../documents/document-adapters.service';
import { OwnerQuotaService } from '../access/owner-quota.service';
import type { PrintAdapter } from '../documents/adapter';
import { PdfInspectorService } from '../rendering/pdf-inspector.service';
import { XsdValidatorService } from '../validation/xsd-validator.service';
import { decodeXmlBytes, type DecodedXml } from '../xml-security/encoding';
import { XmlParserService } from '../xml-security/xml-parser.service';
import type { ParsedXml } from '../xml-security/xml-tree';
import type { ConversionResponseDto } from './conversions.dto';

export const SIGNING_TARGET = 'pdf';
export const SIGNATURE_PROFILE = 'external-detached';
export const SIGNATURE_STATUS = 'not-provided';
export const RENDER_PROFILE = 'chromium-pdf-a4-landscape-v1';

const ALLOWED_MEDIA_TYPES = new Set(['application/octet-stream', 'application/xml', 'text/xml']);

export interface ConvertInput {
  readonly ownerId: string;
  readonly body: unknown;
  readonly contentType: string | undefined;
  readonly documentType?: DocumentTypeHint;
  readonly idempotencyKey?: string;
}

interface Prepared {
  readonly ownerId: string;
  readonly raw: Buffer;
  readonly decoded: DecodedXml;
  readonly parsed: ParsedXml;
  readonly metadata: XmlMetadata;
  readonly descriptor: SchemaDescriptor;
  readonly adapter: PrintAdapter;
  readonly hint?: DocumentTypeHint;
  readonly idempotencyKeyHash?: string;
  readonly fingerprint: string;
  readonly startedAt: number;
}

@Injectable()
export class ConversionsService {
  private readonly inFlight = new Map<string, { promise: Promise<string>; fingerprint: string }>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly parser: XmlParserService,
    private readonly registry: DocumentRegistry,
    private readonly xsd: XsdValidatorService,
    private readonly adapters: DocumentAdaptersService,
    private readonly artifacts: ArtifactsService,
    private readonly inspector: PdfInspectorService,
    private readonly quota: OwnerQuotaService,
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
    if (input.idempotencyKey !== undefined && input.idempotencyKey.length > 128) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Idempotency-Key must not exceed 128 characters');
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
    this.registry.assertHintCompatible(descriptor, input.documentType, metadata);
    const adapter = this.adapters.get(descriptor);

    const sourceSha256 = sha256Hex(input.body);
    const fingerprint = sha256Hex(
      [
        sourceSha256,
        input.documentType ?? '',
        descriptor.id,
        adapter.templateVersion,
        RENDER_PROFILE,
        this.config.appVersion,
      ].join('|'),
    );
    const idempotencyKeyHash = input.idempotencyKey ? sha256Hex(input.idempotencyKey) : undefined;
    const flightKey = `${input.ownerId}:${idempotencyKeyHash ?? ''}`;

    const prepared: Prepared = {
      ownerId: input.ownerId,
      raw: input.body,
      decoded,
      parsed,
      metadata,
      descriptor,
      adapter,
      hint: input.documentType,
      idempotencyKeyHash,
      fingerprint,
      startedAt,
    };

    if (idempotencyKeyHash) {
      const existing = this.artifacts.findIdempotent(input.ownerId, idempotencyKeyHash);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new AppError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This Idempotency-Key was already used with different input or print parameters',
          );
        }
        const artifact = this.artifacts.getOwned(existing.artifactId, input.ownerId);
        return this.buildResponse(artifact);
      }
      const pending = this.inFlight.get(flightKey);
      if (pending) {
        if (pending.fingerprint !== fingerprint) {
          throw new AppError(409, 'REQUEST_IN_PROGRESS', 'A concurrent request with this Idempotency-Key is in flight');
        }
        const artifactId = await pending.promise;
        return this.buildResponse(this.artifacts.getOwned(artifactId, input.ownerId));
      }
    }

    const work = this.runConversion(prepared).then((artifact) => artifact.id);
    if (idempotencyKeyHash) {
      this.inFlight.set(flightKey, { promise: work, fingerprint });
      const cleanup = (): void => {
        this.inFlight.delete(flightKey);
      };
      work.then(cleanup, cleanup);
    }

    const artifactId = await work;
    return this.buildResponse(this.artifacts.getOwned(artifactId, input.ownerId));
  }

  private async runConversion(prepared: Prepared): Promise<Artifact> {
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
        details: business.issues.map((issue) => ({ path: issue.path, message: `${issue.code}: ${issue.message}` })),
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
    const pdf = await prepared.adapter.render(mapped.model);
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

    const artifact = await this.artifacts.create({
      ownerId: prepared.ownerId,
      sourceXml: prepared.raw,
      pdf,
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
      rendererVersion: this.config.rendererVersion,
      businessRulesVersion: prepared.adapter.businessRulesVersion,
      businessStatus,
      schemaRevision: prepared.descriptor.schemaRevision,
      schemaSha256: prepared.descriptor.schemaSha256,
      signatureProfile: SIGNATURE_PROFILE,
      signatureStatus: SIGNATURE_STATUS,
      pdfVersion: inspection.pdfVersion,
      pageCount: inspection.pageCount,
      ttlSeconds: this.config.artifactTtlSeconds,
    });

    if (prepared.idempotencyKeyHash) {
      this.artifacts.saveIdempotent(
        prepared.ownerId,
        prepared.idempotencyKeyHash,
        prepared.fingerprint,
        artifact.id,
        artifact.expiresAt,
      );
    }

    logger.info('conversion.completed', {
      artifactId: artifact.id,
      family: prepared.descriptor.family,
      schemaRevision: prepared.descriptor.schemaRevision,
      xsdMs: xsdResult.durationMs,
      totalMs: Date.now() - prepared.startedAt,
      pdfBytes: artifact.pdfSize,
      pages: artifact.pageCount,
      unmapped: mapped.coverage.unmapped,
    });
    return artifact;
  }

  getById(artifactId: string, ownerId: string): ConversionResponseDto {
    return this.buildResponse(this.artifacts.getOwned(artifactId, ownerId));
  }

  async download(token: string): Promise<{ artifact: Artifact; pdf: Buffer }> {
    return this.artifacts.resolveToken(token);
  }

  buildResponse(artifact: Artifact): ConversionResponseDto {
    const token = this.artifacts.issueToken(artifact);
    return {
      artifactId: artifact.id,
      status: 'ready',
      document: artifact.document,
      validation: artifact.validation,
      sourceSha256: artifact.sourceSha256,
      pdfSha256: artifact.pdfSha256,
      pdfSizeBytes: artifact.pdfSize,
      pageCount: artifact.pageCount,
      templateVersion: artifact.templateVersion,
      signingTarget: SIGNING_TARGET,
      signatureProfile: artifact.signatureProfile,
      signatureStatus: artifact.signatureStatus,
      downloadUrl: `${this.config.publicBaseUrl}/api/v1/downloads/${token.token}`,
      createdAt: artifact.createdAt,
      expiresAt: artifact.expiresAt,
      warnings: artifact.warnings.map((warning) => ({ ...warning })),
    };
  }
}
