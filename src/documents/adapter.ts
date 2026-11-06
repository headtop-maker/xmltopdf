import type { SchemaDescriptor } from '../document-registry/document-registry.service';
import type { XmlMetadata } from '../document-registry/document-registry.service';
import type { BusinessReport } from '../validation/business-report';
import type { ParsedXml } from '../xml-security/xml-tree';
import type { CoverageSummary } from '../mapping/coverage';
import type { ArtifactDocument, ArtifactWarning } from './document.types';

export interface AdapterContext {
  readonly sourceSha256: string;
  readonly metadata: XmlMetadata;
}

export interface MappedDocument<TModel> {
  readonly model: TModel;
  readonly coverage: CoverageSummary;
  readonly warnings: readonly ArtifactWarning[];
}

export interface PrintAdapter<TModel = unknown> {
  readonly descriptor: SchemaDescriptor;
  readonly businessRulesVersion: string;
  readonly templateVersion: string;

  documentFor(metadata: XmlMetadata): ArtifactDocument;

  validateBusiness(parsed: ParsedXml): BusinessReport;

  map(parsed: ParsedXml, context: AdapterContext): MappedDocument<TModel>;

  render(model: TModel): Promise<Buffer>;

  /** Optional source-aware renderer for external template engines. */
  renderSource?(source: Buffer, model: TModel): Promise<Buffer>;
}
