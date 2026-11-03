import type { CoverageSummary } from '../../mapping/coverage';
import type { KeyValue, Torg2Signer } from './torg2.model';

export interface Torg2Title1Model {
  readonly meta: {
    readonly family: 'Torg2';
    readonly titleIndex: 1;
    readonly workflowFunction: 'WithAdditionalInfo';
    readonly formatVersion: string;
    readonly operatorVersion: string;
    readonly schemaRevision: string;
    readonly knd: string;
    readonly sourceId?: string;
    readonly programVersion?: string;
    readonly formedDate: string;
    readonly formedTime: string;
    readonly organization: string;
    readonly organizationBasis?: string;
    readonly sourceSha256: string;
    readonly templateVersion: string;
  };
  readonly reference: {
    readonly fileId: string;
    readonly formedDate?: string;
    readonly formedTime?: string;
    /** Number of ЭП elements in the source; the signature itself is never printed or verified. */
    readonly signatureCount: number;
  };
  readonly results: {
    readonly date?: string;
    readonly content?: string;
    readonly info: readonly KeyValue[];
  };
  readonly signers: readonly Torg2Signer[];
  readonly appendix: readonly { title: string; rows: readonly { label: string; path: string; value: string }[] }[];
  readonly coverage: CoverageSummary;
}
