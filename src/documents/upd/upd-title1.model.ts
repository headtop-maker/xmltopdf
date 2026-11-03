import type { CoverageSummary } from '../../mapping/coverage';
import type { DocumentRef, KeyValue } from '../torg2/torg2.model';
import type { UpdSigner } from './upd.model';

export interface UpdTitle1Model {
  readonly meta: {
    readonly family: 'UniversalTransferDocument';
    readonly titleIndex: 1;
    readonly function: string;
    readonly formatVersion: string;
    readonly operatorVersion: string;
    readonly schemaRevision: string;
    readonly knd: string;
    readonly sourceId?: string;
    readonly documentUid?: string;
    readonly programVersion?: string;
    readonly formedDate: string;
    readonly formedTime: string;
    readonly organization: string;
    readonly sourceSha256: string;
    readonly templateVersion: string;
  };
  readonly reference: {
    readonly sellerFileId: string;
    readonly formedDate?: string;
    readonly formedTime?: string;
    readonly signatureCount: number;
  };
  readonly content: {
    readonly documentName?: string;
    readonly function?: string;
    readonly documentNumber?: string;
    readonly documentDate?: string;
    readonly operationType?: string;
  };
  readonly acceptance: {
    readonly operation?: string;
    readonly date?: string;
    readonly resultCode?: string;
    readonly discrepancyDocument?: DocumentRef;
    readonly person?: {
      readonly role: string;
      readonly fio?: string;
      readonly position?: string;
      readonly organization?: string;
      readonly inn?: string;
      readonly basis?: string;
      readonly other?: string;
    };
  };
  readonly procurement: readonly KeyValue[];
  readonly info: readonly KeyValue[];
  readonly authorityBasis?: DocumentRef;
  readonly signers: readonly UpdSigner[];
  readonly appendix: readonly { title: string; rows: readonly { label: string; path: string; value: string }[] }[];
  readonly coverage: CoverageSummary;
}
