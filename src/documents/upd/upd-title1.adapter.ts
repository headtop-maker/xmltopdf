import { Injectable } from '@nestjs/common';
import { DocumentRegistry, type SchemaDescriptor, type XmlMetadata } from '../../document-registry/document-registry.service';
import type { ArtifactDocument } from '../../artifacts/artifact.types';
import type { ParsedXml } from '../../xml-security/xml-tree';
import type { BusinessReport } from '../../validation/business-report';
import { FieldLabelsService } from '../../mapping/field-labels.service';
import { PdfRendererService } from '../../rendering/pdf-renderer.service';
import type { AdapterContext, MappedDocument, PrintAdapter } from '../adapter';
import { UPD_TITLE1_BUSINESS_RULES_VERSION, validateUpdTitle1Business } from './upd-title1.business';
import { UpdTitle1Mapper } from './upd-title1.mapper';
import type { UpdTitle1Model } from './upd-title1.model';
import { renderUpdTitle1Html } from './upd-title1.template';

@Injectable()
export class UpdTitle1Adapter implements PrintAdapter<UpdTitle1Model> {
  readonly descriptor: SchemaDescriptor;
  readonly businessRulesVersion = UPD_TITLE1_BUSINESS_RULES_VERSION;
  readonly templateVersion = 'upd-title1-v1';

  constructor(
    registry: DocumentRegistry,
    private readonly labels: FieldLabelsService,
    private readonly renderer: PdfRendererService,
  ) {
    this.descriptor = registry.get('utd970_05_03_01_title1');
  }

  documentFor(metadata: XmlMetadata): ArtifactDocument {
    return {
      family: 'UniversalTransferDocument',
      formatVersion: this.descriptor.formatVersion,
      operatorVersion: this.descriptor.operatorVersion,
      titleIndex: this.descriptor.titleIndex,
      function: metadata.documentFunction ?? null,
      workflowFunction: null,
      knd: this.descriptor.knd,
    };
  }

  validateBusiness(parsed: ParsedXml): BusinessReport {
    return validateUpdTitle1Business(parsed);
  }

  map(parsed: ParsedXml, context: AdapterContext): MappedDocument<UpdTitle1Model> {
    const mapper = new UpdTitle1Mapper(
      this.labels.get('upd-title1'),
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

  async render(model: UpdTitle1Model): Promise<Buffer> {
    const html = renderUpdTitle1Html(model, { fontCss: this.renderer.fontStyles() });
    return this.renderer.render(html, {
      sourceSha256: model.meta.sourceSha256,
      documentLabel: `UPD confirmation ${model.content.documentNumber ?? ''}`,
    });
  }
}
