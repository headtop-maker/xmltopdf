import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { APP_CONFIG, type AppConfig } from '../config';
import { ApiKeyGuard } from '../access/api-key.guard';
import { DocumentRegistry } from '../document-registry/document-registry.service';
import { DocumentAdaptersService } from '../documents/document-adapters.service';
import { SIGNATURE_PROFILE, SIGNING_TARGET } from './conversions.service';

@ApiTags('formats')
@Controller('api/v1/formats')
export class FormatsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly registry: DocumentRegistry,
    private readonly adapters: DocumentAdaptersService,
  ) {}

  @Get()
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Implemented document formats, schemas, signing profile and limits',
    description:
      'Only titles with a working print adapter are reported here. Planned titles are not advertised as supported.',
  })
  get(): Record<string, unknown> {
    const implemented = this.registry.implemented().map((descriptor) => {
      const adapter = this.adapters.get(descriptor);
      return {
        family: descriptor.family,
        formatVersion: descriptor.formatVersion,
        operatorVersion: descriptor.operatorVersion,
        titleIndex: descriptor.titleIndex,
        titleLabel: descriptor.titleLabel,
        knd: descriptor.knd,
        functions: descriptor.functions,
        supportedFunctions: descriptor.supportedFunctions,
        schemaRevision: descriptor.schemaRevision,
        schemaSha256: descriptor.schemaSha256,
        templateVersion: adapter.templateVersion,
        businessRulesVersion: adapter.businessRulesVersion,
        implemented: true,
      };
    });

    return {
      formats: implemented,
      signing: {
        signingTarget: SIGNING_TARGET,
        signatureProfile: SIGNATURE_PROFILE,
        signatureStatus: 'not-provided',
        note:
          'The converter produces the exact bytes to be signed. Signature creation and verification ' +
          'happen in an external system; no signature claims are made here.',
      },
      limits: {
        maxBodyBytes: this.config.limits.maxBodyBytes,
        maxDecodedBytes: this.config.limits.maxDecodedBytes,
        maxElements: this.config.limits.maxElements,
        maxDepth: this.config.limits.maxDepth,
        maxValueChars: this.config.limits.maxValueChars,
        maxGoodsRows: this.config.limits.maxGoodsRows,
        maxPdfPages: this.config.limits.maxPdfPages,
        maxPdfBytes: this.config.limits.maxPdfBytes,
        artifactTtlSeconds: this.config.artifactTtlSeconds,
        downloadTokenTtlSeconds: this.config.downloadTokenTtlSeconds,
        rateLimitPerMinute: this.config.rateLimitPerMinute,
      },
      supportedEncodings: ['UTF-8 (with or without BOM)', 'windows-1251', 'UTF-16LE/BE'],
      renderer: {
        profile: 'chromium-pdf-a4-landscape-v1',
        pageSize: 'A4',
        orientation: 'landscape',
        basePdfVersion: 'as emitted by the pinned Chromium (PDF 1.4 for Skia m156)',
      },
      approvals: {
        normativeProfiles: ['torg2-business-v1'],
        note: 'Formalized XML print composition follows the provided sample; normative acceptance is tracked in docs/compliance-matrix.md.',
      },
    };
  }
}
