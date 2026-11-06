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
