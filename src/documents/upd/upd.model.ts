import type { CoverageSummary } from '../../mapping/coverage';
import type { PartyModel } from '../shared/party';
import type { DocumentRef, KeyValue } from '../torg2/torg2.model';

export type UpdFunction = 'СЧФ' | 'ДОП' | 'СЧФДОП' | 'СвРК' | 'СвЗК';

export interface UpdCurrency {
  readonly code?: string;
  readonly name?: string;
  readonly rate?: string;
}

export interface UpdAmounts {
  readonly withoutVat?: string;
  readonly vat?: string;
  readonly withVat?: string;
}

export interface UpdPaymentDocument {
  readonly number?: string;
  readonly date?: string;
  readonly amount?: string;
}

export interface UpdRowExtra {
  readonly productKind?: string;
  readonly productKindInfo?: string;
  readonly orderedQuantity?: string;
  readonly characteristic?: string;
  readonly sort?: string;
  readonly series?: string;
  readonly article?: string;
  readonly code?: string;
  readonly gtin?: string;
  readonly catalogCode?: string;
  readonly productTypeCode?: string;
  readonly productCode?: string;
  readonly okpd2?: string;
  readonly operationInfo?: string;
}

export interface UpdMarking {
  readonly kiz: readonly string[];
  readonly packaging: readonly string[];
  readonly transportPackaging?: string;
}

export interface UpdTraceability {
  readonly batchNumber?: string;
  readonly unitCode?: string;
  readonly unitName?: string;
  readonly quantity?: string;
  readonly amountWithoutVat?: string;
  readonly info?: string;
}

export interface UpdRow {
  readonly number: string;
  readonly name?: string;
  readonly unitName?: string;
  readonly unitCode?: string;
  readonly quantity?: string;
  readonly price?: string;
  readonly amountWithoutVat?: string;
  readonly vatRate: string;
  readonly vatAmount?: string;
  readonly vatNone?: boolean;
  readonly amountWithVat?: string;
  readonly exciseAmount?: string;
  readonly exciseNone?: boolean;
  readonly countryCode?: string;
  readonly countryNames: readonly string[];
  readonly customsNumbers: readonly string[];
  readonly extra?: UpdRowExtra;
  readonly marking: UpdMarking;
  readonly traceability: readonly UpdTraceability[];
  readonly accessoryDocuments: readonly DocumentRef[];
  readonly info: readonly KeyValue[];
}

export interface UpdTransfer {
  readonly operationContent?: string;
  readonly operationType?: string;
  readonly date?: string;
  readonly periodStart?: string;
  readonly periodEnd?: string;
  readonly bases: readonly DocumentRef[];
  readonly withoutBasisDocument?: boolean;
  readonly person?: {
    readonly role: string;
    readonly fio?: string;
    readonly position?: string;
    readonly organization?: string;
    readonly basis?: string;
    readonly other?: string;
  };
  readonly transport?: {
    readonly description?: string;
    readonly incoterms?: string;
    readonly incotermsVersion?: string;
  };
  readonly thingTransfer?: {
    readonly date?: string;
    readonly description?: string;
    readonly document?: DocumentRef;
  };
  readonly info: readonly KeyValue[];
}

export interface UpdSigner {
  readonly fio?: string;
  readonly position?: string;
  readonly signatureType?: string;
  readonly authorityMethod?: string;
  readonly signedDate?: string;
  readonly additional?: string;
  readonly powersOfAttorney: readonly string[];
}

export interface UpdPrintModel {
  readonly meta: {
    readonly family: 'UniversalTransferDocument';
    readonly function: UpdFunction;
    readonly functionLabel: string;
    readonly formatVersion: string;
    readonly operatorVersion: string;
    readonly schemaRevision: string;
    readonly knd: string;
    readonly sourceId?: string;
    readonly documentUid?: string;
    readonly programVersion?: string;
    readonly number: string;
    readonly date: string;
    readonly correctionNumber?: string;
    readonly correctionDate?: string;
    readonly formedDate?: string;
    readonly formedTime?: string;
    readonly documentName?: string;
    readonly subjectDescription?: string;
    readonly organization?: string;
    readonly sourceSha256: string;
    readonly templateVersion: string;
    readonly currency: UpdCurrency;
  };
  readonly parties: {
    readonly sellers: readonly PartyModel[];
    readonly buyers: readonly PartyModel[];
    readonly shippers: readonly PartyModel[];
    readonly consignees: readonly PartyModel[];
    readonly shipperSameAsSeller: boolean;
    readonly factor?: PartyModel;
  };
  readonly invoice: {
    readonly paymentDocuments: readonly UpdPaymentDocument[];
    readonly shipmentDocuments: readonly DocumentRef[];
    readonly gosContractId?: string;
    readonly specialCircumstances: readonly KeyValue[];
    readonly obligationTypes: readonly KeyValue[];
    readonly authorityBasis?: DocumentRef;
    readonly correctedSellerFile?: string;
    readonly correctedBuyerFile?: string;
    readonly info: readonly KeyValue[];
  };
  readonly rows: readonly UpdRow[];
  readonly totals: {
    readonly withoutVat?: string;
    readonly vat?: string;
    readonly withVat?: string;
    readonly netQuantity?: string;
    readonly vatNone?: boolean;
  };
  readonly transfer?: UpdTransfer;
  readonly signers: readonly UpdSigner[];
  readonly appendix: readonly { title: string; rows: readonly { label: string; path: string; value: string }[] }[];
  readonly coverage: CoverageSummary;
}
