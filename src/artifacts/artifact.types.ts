export interface ArtifactDocument {
  readonly family: string;
  readonly formatVersion: string;
  readonly operatorVersion: string;
  readonly titleIndex: number;
  readonly function: string | null;
  readonly workflowFunction: string | null;
  readonly knd: string;
}

export interface ArtifactValidation {
  readonly xsd: 'valid';
  readonly schemaRevision: string;
  readonly schemaSha256: string;
  readonly businessRulesVersion: string;
  readonly business: 'passed' | 'passed-with-warnings' | 'not-configured' | 'failed';
  readonly unmappedCount: number;
}

export interface ArtifactWarning {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface Artifact {
  readonly id: string;
  readonly ownerId: string;
  readonly state: 'ready' | 'failed' | 'expired';
  readonly sourceSha256: string;
  readonly pdfSha256: string;
  readonly sourceSize: number;
  readonly pdfSize: number;
  readonly pageCount: number;
  readonly pdfVersion: string;
  readonly document: ArtifactDocument;
  readonly validation: ArtifactValidation;
  readonly warnings: readonly ArtifactWarning[];
  readonly templateVersion: string;
  readonly rendererVersion: string;
  readonly businessRulesVersion: string;
  readonly businessStatus: string;
  readonly schemaRevision: string;
  readonly schemaSha256: string;
  readonly signatureProfile: string;
  readonly signatureStatus: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface CreateArtifactInput {
  readonly ownerId: string;
  readonly sourceXml: Buffer;
  readonly pdf: Buffer;
  readonly document: ArtifactDocument;
  readonly validation: ArtifactValidation;
  readonly warnings: readonly ArtifactWarning[];
  readonly templateVersion: string;
  readonly rendererVersion: string;
  readonly businessRulesVersion: string;
  readonly businessStatus: string;
  readonly schemaRevision: string;
  readonly schemaSha256: string;
  readonly signatureProfile: string;
  readonly signatureStatus: string;
  readonly pdfVersion: string;
  readonly pageCount: number;
  readonly ttlSeconds: number;
}
