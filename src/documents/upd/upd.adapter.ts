import { Injectable } from '@nestjs/common';
import { DocumentRegistry, type SchemaDescriptor, type XmlMetadata } from '../../document-registry/document-registry.service';
import type { ArtifactDocument } from '../../artifacts/artifact.types';
import type { ParsedXml } from '../../xml-security/xml-tree';
import type { BusinessReport } from '../../validation/business-report';
import { FieldLabelsService } from '../../mapping/field-labels.service';
import { PdfRendererService } from '../../rendering/pdf-renderer.service';
import type { AdapterContext, MappedDocument, PrintAdapter } from '../adapter';
import { UPD_BUSINESS_RULES_VERSION, validateUpdBusiness } from './upd.business';
import { UpdMapper } from './upd.mapper';
import type { UpdFunction, UpdPrintModel } from './upd.model';
import { renderUpdHtml } from './upd.template';
import { renderUpdSabyHtml } from './upd-saby.template';

@Injectable()
export class UpdAdapter implements PrintAdapter<UpdPrintModel> {
  readonly descriptor: SchemaDescriptor;
  readonly businessRulesVersion = UPD_BUSINESS_RULES_VERSION;
  readonly templateVersion = 'upd-title0-v1';

  constructor(
    registry: DocumentRegistry,
    private readonly labels: FieldLabelsService,
    private readonly renderer: PdfRendererService,
  ) {
    this.descriptor = registry.get('utd970_05_03_01_title0');
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
    return validateUpdBusiness(parsed);
  }

  map(parsed: ParsedXml, context: AdapterContext): MappedDocument<UpdPrintModel> {
    const mapper = new UpdMapper(
      this.labels.get('upd-title0'),
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

  async render(model: UpdPrintModel): Promise<Buffer> {
    const useSabyLayout = process.env.UPD_SABY_LAYOUT === 'true' && model.meta.function === 'СЧФДОП';
    const html = useSabyLayout
      ? renderUpdSabyHtml(model, { fontCss: this.renderer.fontStyles() })
      : renderUpdHtml(model, { fontCss: this.renderer.fontStyles() });
    const label =
      model.meta.function === 'СЧФ'
        ? 'INVOICE'
        : model.meta.function === 'ДОП'
          ? 'SHIPMENT'
          : model.meta.function === 'СвРК'
            ? 'SVRK'
            : model.meta.function === 'СвЗК'
              ? 'SVZK'
              : 'UPD';
    return this.renderer.render(html, {
      sourceSha256: model.meta.sourceSha256,
      documentLabel: `${label} ${model.meta.number}`,
    });
  }
}

export type { UpdFunction };
