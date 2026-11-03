import type { CoverageSummary } from '../../mapping/coverage';
import type { PartyModel } from '../shared/party';

export interface KeyValue {
  readonly id: string;
  readonly value: string;
}

export interface DocumentRef {
  readonly name?: string;
  readonly kind?: string;
  readonly number?: string;
  readonly date?: string;
  readonly additionalId?: string;
}

export interface TransportDocument {
  readonly name?: string;
  readonly additionalId?: string;
  readonly number?: string;
  readonly date?: string;
  readonly seals?: string;
  readonly packaging?: string;
  readonly places?: string;
  readonly cargoName?: string;
  readonly unitName?: string;
  readonly unitCode?: string;
  readonly massDocGross?: string;
  readonly massDocNet?: string;
  readonly massFactGross?: string;
  readonly massFactNet?: string;
  readonly info: readonly KeyValue[];
}

export interface Amounts {
  readonly quantity?: string;
  readonly price?: string;
  readonly vatRate?: string;
  readonly amountWithVat?: string;
  readonly vatAmount?: string;
}

export interface Discrepancy extends Amounts {
  readonly note?: string;
}

export interface PriceDelta {
  readonly price?: string;
  readonly amountWithVat?: string;
  readonly vatAmount?: string;
  readonly note?: string;
}

export interface MarkingCodes {
  readonly kiz: readonly string[];
  readonly packaging: readonly string[];
  readonly transportPackaging?: string;
}

export interface GoodsRow {
  readonly number: number;
  readonly sourceLine?: string;
  readonly name: string;
  readonly characteristic?: string;
  readonly sort?: string;
  readonly article?: string;
  readonly code?: string;
  readonly passport?: string;
  readonly unitName?: string;
  readonly unitCode?: string;
  readonly byDocument?: Amounts;
  readonly byFact?: Amounts;
  readonly defect?: Discrepancy;
  readonly breakage?: Discrepancy;
  readonly shortage?: Discrepancy;
  readonly surplus?: Discrepancy;
  readonly positiveDelta?: PriceDelta;
  readonly negativeDelta?: PriceDelta;
  readonly marking: MarkingCodes;
  readonly info: readonly KeyValue[];
}

export interface PartyBlock {
  seller?: PartyModel;
  buyer?: PartyModel;
  shipper?: PartyModel;
  consignee?: PartyModel;
  carrier?: PartyModel;
  insurer?: PartyModel;
}

export interface Torg2Basis {
  readonly orderDate?: string;
  readonly orderNumber?: string;
  readonly gosContractId?: string;
  readonly operationCode?: string;
  readonly operationLabel?: string;
}

export interface Torg2Inspection {
  readonly date?: string;
  readonly place?: string;
  readonly timeStart?: string;
  readonly timeEnd?: string;
  readonly shippingDate?: string;
  /** СвВремПрием/@ВскрытГруз; never falls back to the act date. */
  readonly openingDate?: string;
  readonly certificates: readonly string[];
  readonly accompanyingDocuments: readonly DocumentRef[];
  readonly transportDocuments: readonly TransportDocument[];
  readonly timeline: readonly KeyValue[];
  readonly storageConditions?: string;
  readonly packagingState?: string;
  readonly shortageMethod?: string;
  readonly otherInfo?: string;
  readonly acceptedBy?: {
    readonly role: string;
    readonly fio?: string;
    readonly position?: string;
    readonly organization?: string;
    readonly basis?: string;
    readonly other?: string;
  };
  readonly info: readonly KeyValue[];
}

export interface Torg2Signer {
  readonly kind: 'ЮЛ' | 'ИП' | 'ФЛ' | 'не указано';
  readonly fio?: string;
  readonly position?: string;
  readonly organization?: string;
  readonly inn?: string;
  readonly other?: string;
  readonly basis: string;
  readonly organizationBasis?: string;
  readonly acknowledgment?: string;
  readonly statusCode?: string;
  readonly scopeCode?: string;
}

export interface TotalsBlock {
  readonly quantity?: string;
  readonly amountWithVat?: string;
  readonly vatAmount?: string;
}

export interface Torg2Totals {
  readonly byDocument: TotalsBlock;
  readonly byFact: TotalsBlock;
  readonly shortage: TotalsBlock;
  readonly surplus: TotalsBlock;
  readonly defect: TotalsBlock;
  readonly breakage: TotalsBlock;
}

export interface AppendixRow {
  readonly label: string;
  readonly path: string;
  readonly value: string;
}

export interface AppendixGroup {
  readonly title: string;
  readonly rows: readonly AppendixRow[];
}

export interface Torg2PrintModel {
  readonly meta: {
    readonly family: 'Torg2';
    readonly formatVersion: string;
    readonly operatorVersion: string;
    readonly schemaRevision: string;
    readonly knd: string;
    readonly sourceId?: string;
    readonly programVersion?: string;
    readonly documentNumber: string;
    readonly documentDate: string;
    readonly actName: string;
    readonly actKind?: string;
    readonly correctionNumber?: string;
    readonly correctionDate?: string;
    readonly formedDate?: string;
    readonly formedTime?: string;
    readonly organization: string;
    readonly organizationBasis?: string;
    readonly documentCircumstances?: string;
    readonly additionalInfoPurpose?: string;
    readonly additionalInfoCodes: readonly string[];
    readonly sourceSha256: string;
    readonly templateVersion: string;
  };
  readonly parties: PartyBlock;
  readonly basis: Torg2Basis;
  readonly inspection: Torg2Inspection;
  readonly rows: readonly GoodsRow[];
  readonly totals: Torg2Totals;
  readonly event: {
    readonly description?: string;
    readonly conclusion?: string;
    readonly operationType?: string;
    readonly info: readonly KeyValue[];
  };
  readonly attachments: readonly DocumentRef[];
  readonly signers: readonly Torg2Signer[];
  readonly appendix: readonly AppendixGroup[];
  readonly coverage: CoverageSummary;
}
