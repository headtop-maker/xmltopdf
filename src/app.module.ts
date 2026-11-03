import { Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config';
import { ApiKeyGuard } from './access/api-key.guard';
import { OwnerQuotaService } from './access/owner-quota.service';
import { ArtifactsService } from './artifacts/artifacts.service';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { ConversionsController, DownloadsController } from './conversions/conversions.controller';
import { ConversionsService } from './conversions/conversions.service';
import { FormatsController } from './conversions/formats.controller';
import { DocumentAdaptersService } from './documents/document-adapters.service';
import { Torg2Adapter } from './documents/torg2/torg2.adapter';
import { UpdAdapter } from './documents/upd/upd.adapter';
import { UpdTitle1Adapter } from './documents/upd/upd-title1.adapter';
import { Torg2Title1Adapter } from './documents/torg2/torg2-title1.adapter';
import { DocumentRegistry } from './document-registry/document-registry.service';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { FieldLabelsService } from './mapping/field-labels.service';
import { PdfInspectorService } from './rendering/pdf-inspector.service';
import { PdfRendererService } from './rendering/pdf-renderer.service';
import { XsdValidatorService } from './validation/xsd-validator.service';
import { XmlParserService } from './xml-security/xml-parser.service';

@Module({
  controllers: [ConversionsController, DownloadsController, FormatsController, HealthController],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    AllExceptionsFilter,
    XmlParserService,
    XsdValidatorService,
    DocumentRegistry,
    FieldLabelsService,
    PdfRendererService,
    PdfInspectorService,
    ArtifactsService,
    Torg2Adapter,
    Torg2Title1Adapter,
    UpdAdapter,
    UpdTitle1Adapter,
    DocumentAdaptersService,
    ConversionsService,
    ApiKeyGuard,
    OwnerQuotaService,
    HealthService,
  ],
})
export class AppModule {}
