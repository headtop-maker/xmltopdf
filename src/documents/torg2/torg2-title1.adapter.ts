import { Injectable } from '@nestjs/common';
import { DocumentRegistry, type SchemaDescriptor, type XmlMetadata } from '../../document-registry/document-registry.service';
import type { ArtifactDocument } from '../document.types';
import type { ParsedXml } from '../../xml-security/xml-tree';
import type { BusinessReport } from '../../validation/business-report';
import { FieldLabelsService } from '../../mapping/field-labels.service';
import { PdfRendererService } from '../../rendering/pdf-renderer.service';
import type { AdapterContext, MappedDocument, PrintAdapter } from '../adapter';
import { TORG2_TITLE1_BUSINESS_RULES_VERSION, validateTorg2Title1Business } from './torg2-title1.business';
import { Torg2Title1Mapper } from './torg2-title1.mapper';
import type { Torg2Title1Model } from './torg2-title1.model';
import { renderTorg2Title1Html } from './torg2-title1.template';

@Injectable()
export class Torg2Title1Adapter implements PrintAdapter<Torg2Title1Model> {
  readonly descriptor: SchemaDescriptor;
  readonly businessRulesVersion = TORG2_TITLE1_BUSINESS_RULES_VERSION;
  readonly templateVersion = 'torg2-title1-v1';

  constructor(
    registry: DocumentRegistry,
    private readonly labels: FieldLabelsService,
    private readonly renderer: PdfRendererService,
  ) {
    this.descriptor = registry.get('torg2_05_01_01_title1');
  }

  documentFor(_metadata: XmlMetadata): ArtifactDocument {
    return {
      family: 'Torg2',
      formatVersion: this.descriptor.formatVersion,
      operatorVersion: this.descriptor.operatorVersion,
      titleIndex: this.descriptor.titleIndex,
      function: null,
      workflowFunction: 'WithAdditionalInfo',
      knd: this.descriptor.knd,
    };
  }

  validateBusiness(parsed: ParsedXml): BusinessReport {
    return validateTorg2Title1Business(parsed);
  }

  map(parsed: ParsedXml, context: AdapterContext): MappedDocument<Torg2Title1Model> {
    const mapper = new Torg2Title1Mapper(
      this.labels.get('torg2-title1'),
      context.sourceSha256,
      this.descriptor.schemaRevision,
      this.descriptor.formatVersion,
      this.descriptor.operatorVersion,
      this.templateVersion,
    );
    const result = mapper.map(parsed);
    return {
      model: result.model,
      coverage: result.coverage,
      warnings: result.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
    };
  }

  async render(model: Torg2Title1Model): Promise<Buffer> {
    const html = renderTorg2Title1Html(model, { fontCss: this.renderer.fontStyles() });
    return this.renderer.render(html, {
      sourceSha256: model.meta.sourceSha256,
      documentLabel: `TORG-2 additional ${model.meta.formedDate}`,
    });
  }
}
