import { Injectable, Optional } from '@nestjs/common';
import { DocumentRegistry, type SchemaDescriptor, type XmlMetadata } from '../../document-registry/document-registry.service';
import type { ArtifactDocument } from '../../artifacts/artifact.types';
import { FieldLabelsService } from '../../mapping/field-labels.service';
import type { ParsedXml } from '../../xml-security/xml-tree';
import type { BusinessReport } from '../../validation/business-report';
import { PdfRendererService } from '../../rendering/pdf-renderer.service';
import { VislibRendererService } from '../../rendering/vislib-renderer.service';
import type { AdapterContext, MappedDocument, PrintAdapter } from '../adapter';
import { TORG2_BUSINESS_RULES_VERSION, validateTorg2Business } from './torg2.business';
import { Torg2Mapper } from './torg2.mapper';
import type { Torg2PrintModel } from './torg2.model';
import { renderTorg2Html } from './torg2.template';

@Injectable()
export class Torg2Adapter implements PrintAdapter<Torg2PrintModel> {
  readonly descriptor: SchemaDescriptor;
  readonly businessRulesVersion = TORG2_BUSINESS_RULES_VERSION;
  readonly templateVersion = 'torg2-title0-v1';

  constructor(
    registry: DocumentRegistry,
    private readonly labels: FieldLabelsService,
    private readonly renderer: PdfRendererService,
    @Optional() private readonly vislib?: VislibRendererService,
  ) {
    this.descriptor = registry.get('torg2_05_01_01_title0');
  }

  documentFor(_metadata: XmlMetadata): ArtifactDocument {
    return {
      family: 'Torg2',
      formatVersion: this.descriptor.formatVersion,
      operatorVersion: this.descriptor.operatorVersion,
      titleIndex: this.descriptor.titleIndex,
      function: null,
      workflowFunction: null,
      knd: this.descriptor.knd,
    };
  }

  validateBusiness(parsed: ParsedXml): BusinessReport {
    return validateTorg2Business(parsed);
  }

  map(parsed: ParsedXml, context: AdapterContext): MappedDocument<Torg2PrintModel> {
    const mapper = new Torg2Mapper(
      this.labels.get('torg2-title0'),
      context.sourceSha256,
      this.descriptor.schemaRevision,
      this.descriptor.formatVersion,
      this.descriptor.operatorVersion,
      this.templateVersion,
      1000,
    );
    const result = mapper.map(parsed);
    return {
      model: result.model,
      coverage: result.coverage,
      warnings: result.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
    };
  }

  async renderSource(source: Buffer, model: Torg2PrintModel): Promise<Buffer> {
    if (this.vislib?.enabled) {
      return this.vislib.render(source);
    }
    return this.render(model);
  }

  async render(model: Torg2PrintModel): Promise<Buffer> {
    const html = renderTorg2Html(model, { fontCss: this.renderer.fontStyles() });
    return this.renderer.render(html, {
      sourceSha256: model.meta.sourceSha256,
      documentLabel: `TORG-2 ${model.meta.documentNumber}`,
    });
  }
}
