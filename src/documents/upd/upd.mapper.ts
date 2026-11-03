import { collectCoverage, summarizeCoverage, type CoverageSummary, type FieldLabelSource } from '../../mapping/coverage';
import { FieldTracker } from '../../mapping/field-tracker';
import { XmlNode, type ParsedXml } from '../../xml-security/xml-tree';
import type { DocumentRef, KeyValue } from '../torg2/torg2.model';
import { formatFio, readParty, type PartyModel } from '../shared/party';
import { sumDecimals } from '../shared/format';
import { XmlAccessor } from '../shared/xml-access';
import { readUpdSigner } from './upd.signers';
import type {
  UpdCurrency,
  UpdMarking,
  UpdPaymentDocument,
  UpdPrintModel,
  UpdRow,
  UpdRowExtra,
  UpdTraceability,
  UpdTransfer,
} from './upd.model';
import type { UpdFunction } from './upd.model';

const FUNCTION_LABELS: Record<UpdFunction, string> = {
  СЧФ: 'Счёт-фактура',
  ДОП: 'Документ об отгрузке товаров (выполнении работ), передаче имущественных прав',
  СЧФДОП: 'Универсальный передаточный документ: счёт-фактура и документ об отгрузке',
  СвРК:
    'Документ, включающий в себя сведения о факте реализации комиссионером (агентом, действующим от собственного имени) товаров комитента (принципала)',
  СвЗК:
    'Документ, включающий в себя сведения о факте закупки комиссионером (агентом, действующим от собственного имени) товаров для комитента (принципала)',
};

const SPECIAL_CIRCUMSTANCES: Record<string, string> = {
  СпОбстФСЧФ: 'Специальные обстоятельства формирования счёта-фактуры',
  СпОбстФСЧФДОП: 'Специальные обстоятельства формирования УПД',
  СпОбстФДОП: 'Специальные обстоятельства формирования документа об отгрузке',
};

/**
 * Maps a UPD seller title (titleIndex=0, КНД 1115131, version 5.03).
 *
 * The print meaning depends on Документ/@Функция: СЧФ is printed as an
 * invoice, ДОП as a shipment document, СЧФДОП as both. Transfer data is never
 * added to a pure invoice: if it is present there, it is reported as a warning
 * and left to the appendix.
 */
export class UpdMapper {
  private readonly tracker = new FieldTracker();
  private readonly acc = new XmlAccessor(this.tracker);
  private readonly warnings: { code: string; message: string }[] = [];

  constructor(
    private readonly labels: FieldLabelSource,
    private readonly sourceSha256: string,
    private readonly schemaRevision: string,
    private readonly formatVersion: string,
    private readonly operatorVersion: string,
    private readonly templateVersion: string,
  ) {}

  map(parsed: ParsedXml): {
    model: UpdPrintModel;
    coverage: CoverageSummary;
    warnings: { code: string; message: string }[];
  } {
    const root = parsed.root;
    const document = root.child('Документ');
    if (!document) throw new Error('UPD adapter received XML without Документ');
    const invoiceNode = document.child('СвСчФакт');
    if (!invoiceNode) throw new Error('UPD adapter received XML without СвСчФакт');

    const documentFunction = this.acc.attr(document, 'Функция');
    if (!documentFunction || !(documentFunction in FUNCTION_LABELS)) {
      throw new Error(`UPD adapter received an unsupported function: ${documentFunction ?? '(missing)'}`);
    }
    const fn = documentFunction as UpdFunction;

    const sourceId = this.acc.attr(root, 'ИдФайл');
    this.acc.attr(root, 'ВерсФорм');
    const programVersion = this.acc.attr(root, 'ВерсПрог', 'technical', 'Версия программы формирования файла');
    const knd = this.acc.attr(document, 'КНД') ?? '';
    const documentUid = this.acc.attr(document, 'УИД');
    const formedDate = this.acc.attr(document, 'ДатаИнфПр');
    const formedTime = this.acc.attr(document, 'ВремИнфПр');
    const documentName = this.acc.attr(document, 'НаимДокОпр');
    const subjectDescription = this.acc.attr(document, 'ПоФактХЖ');
    const organization = this.acc.attr(document, 'НаимЭконСубСост');
    this.acc.attr(document, 'СоглСтрДопИнф', 'technical', 'Признак согласованной структуры дополнительных сведений');

    const number = this.acc.attr(invoiceNode, 'НомерДок') ?? '';
    const date = this.acc.attr(invoiceNode, 'ДатаДок') ?? '';
    const correctionNode = invoiceNode.child('ИспрДок');
    const correctionNumber = this.acc.attr(correctionNode, 'НомИспр');
    const correctionDate = this.acc.attr(correctionNode, 'ДатаИспр');

    const sellerNodes = invoiceNode.childrenNamed('СвПрод');
    const buyerNodes = invoiceNode.childrenNamed('СвПокуп');
    const sellers = sellerNodes.map((node) => readParty(this.acc, node)).filter((p): p is PartyModel => Boolean(p));
    const buyers = buyerNodes.map((node) => readParty(this.acc, node)).filter((p): p is PartyModel => Boolean(p));

    const shippers: PartyModel[] = [];
    let shipperSameAsSeller = false;
    for (const group of invoiceNode.childrenNamed('ГрузОт')) {
      const participant = group.child('ГрузОтпр');
      const same = group.child('ОнЖе');
      if (participant) {
        const party = readParty(this.acc, participant);
        if (party) shippers.push(party);
      } else if (same) {
        this.acc.text(same);
        shipperSameAsSeller = true;
      }
    }
    const consignees = invoiceNode
      .childrenNamed('ГрузПолуч')
      .map((node) => readParty(this.acc, node))
      .filter((p): p is PartyModel => Boolean(p));

    const currency: UpdCurrency = {
      code: this.acc.attr(invoiceNode.child('ДенИзм'), 'КодОКВ'),
      name: this.acc.attr(invoiceNode.child('ДенИзм'), 'НаимОКВ'),
      rate: this.acc.attr(invoiceNode.child('ДенИзм'), 'КурсВал'),
    };

    const paymentDocuments: UpdPaymentDocument[] = invoiceNode.childrenNamed('СвПРД').map((node) => ({
      number: this.acc.attr(node, 'НомерПРД'),
      date: this.acc.attr(node, 'ДатаПРД'),
      amount: this.acc.attr(node, 'СуммаПРД'),
    }));

    const shipmentDocuments = invoiceNode.childrenNamed('ДокПодтвОтгрНом').map((node) => this.readDocRef(node));

    const extraDetails = invoiceNode.child('ДопСвФХЖ1');
    const specialCircumstances: KeyValue[] = [];
    if (extraDetails) {
      for (const [attribute, label] of Object.entries(SPECIAL_CIRCUMSTANCES)) {
        const value = this.acc.attr(extraDetails, attribute);
        if (value) specialCircumstances.push({ id: label, value });
      }
    }
    const obligationTypes: KeyValue[] = (extraDetails?.childrenNamed('ВидОбяз') ?? []).map((node) => ({
      id: this.acc.attr(node, 'КодВидОбяз') ?? '',
      value: this.acc.attr(node, 'НаимВидОбяз') ?? '',
    }));

    const factorNode = extraDetails?.child('СвФактор');
    const factor = factorNode ? readParty(this.acc, factorNode) : undefined;

    const authorityNode = document.child('ОснДоверОргСост');
    const authorityBasis = authorityNode ? this.readDocRef(authorityNode) : undefined;

    const invoiceInfo = this.readInfoFields(invoiceNode.child('ИнфПолФХЖ1'));

    const invoice = {
      paymentDocuments,
      shipmentDocuments,
      gosContractId: this.acc.attr(extraDetails, 'ИдГосКон'),
      specialCircumstances,
      obligationTypes,
      authorityBasis,
      correctedSellerFile: this.acc.attr(invoiceNode, 'ИмяФайлИспрПрод'),
      correctedBuyerFile: this.acc.attr(invoiceNode, 'ИмяФайлИспрПок'),
      info: invoiceInfo,
    };

    const table = document.child('ТаблСчФакт');
    const rows = (table?.childrenNamed('СведТов') ?? []).map((node) => this.readRow(node));

    const totalsNode = table?.child('ВсегоОпл');
    const totalVat = this.readVat(totalsNode?.child('СумНалВсего'));
    const totals = {
      withoutVat: this.acc.attr(totalsNode, 'СтТовБезНДСВсего') ?? sumRows(rows, 'amountWithoutVat'),
      vat: totalVat.amount ?? sumRows(rows, 'vatAmount'),
      withVat: this.acc.attr(totalsNode, 'СтТовУчНалВсего') ?? sumRows(rows, 'amountWithVat'),
      netQuantity: this.acc.attr(totalsNode, 'КолНеттоВс'),
      vatNone: totalVat.none,
    };

    const transferNode = document.child('СвПродПер');
    let transfer: UpdTransfer | undefined;
    if (transferNode && fn === 'СЧФ') {
      this.warnings.push({
        code: 'TRANSFER_DATA_IN_INVOICE',
        message:
          'Документ/@Функция=СЧФ but СвПродПер is present; transfer data is not printed as part of the invoice ' +
          'and is emitted to the appendix',
      });
    } else if (transferNode) {
      transfer = this.readTransfer(transferNode);
    }

    const signers = document.childrenNamed('Подписант').map((node) => readUpdSigner(this.acc, node));

    const firstPass = collectCoverage(root, this.tracker, this.labels);
    const appendixRows = firstPass.filter((item) => item.status === 'unmapped' || item.status === 'appendix');
    for (const item of appendixRows) this.tracker.mark(item.key, 'appendix');
    const coverage = summarizeCoverage(collectCoverage(root, this.tracker, this.labels));

    const appendix = groupAppendix(appendixRows);

    const model: UpdPrintModel = {
      meta: {
        family: 'UniversalTransferDocument',
        function: fn,
        functionLabel: FUNCTION_LABELS[fn],
        formatVersion: this.formatVersion,
        operatorVersion: this.operatorVersion,
        schemaRevision: this.schemaRevision,
        knd,
        sourceId,
        documentUid,
        programVersion,
        number,
        date,
        correctionNumber,
        correctionDate,
        formedDate,
        formedTime,
        documentName,
        subjectDescription,
        organization,
        sourceSha256: this.sourceSha256,
        templateVersion: this.templateVersion,
        currency,
      },
      parties: {
        sellers,
        buyers,
        shippers,
        consignees,
        shipperSameAsSeller,
        factor,
      },
      invoice,
      rows,
      totals,
      transfer,
      signers,
      appendix,
      coverage,
    };

    return { model, coverage, warnings: this.warnings };
  }

  private readDocRef(node: XmlNode): DocumentRef {
    return {
      kind: this.acc.attr(node, 'РеквНаимДок'),
      number: this.acc.attr(node, 'РеквНомерДок'),
      date: this.acc.attr(node, 'РеквДатаДок'),
      additionalId: this.acc.attr(node, 'РеквИдФайлДок') ?? this.acc.attr(node, 'РеквИдДок'),
    };
  }

  private readInfoFields(node: XmlNode | undefined): KeyValue[] {
    if (!node) return [];
    this.acc.attr(node, 'ИдФайлИнфПол', 'technical', 'Идентификатор информационного поля');
    return node.childrenNamed('ТекстИнф').map((child) => ({
      id: this.acc.attr(child, 'Идентиф') ?? '',
      value: this.acc.attr(child, 'Значен') ?? '',
    }));
  }

  private readVat(node: XmlNode | undefined): { amount?: string; none?: boolean } {
    if (!node) return {};
    const value = node.child('СумНал');
    if (value) return { amount: this.acc.text(value) };
    const none = node.child('БезНДС');
    if (none) {
      this.acc.text(none);
      return { none: true };
    }
    return {};
  }

  private readExcise(node: XmlNode | undefined): { amount?: string; none?: boolean } {
    if (!node) return {};
    const value = node.child('СумАкциз');
    if (value) return { amount: this.acc.text(value) };
    const none = node.child('БезАкциз');
    if (none) {
      this.acc.text(none);
      return { none: true };
    }
    return {};
  }

  private readRow(node: XmlNode): UpdRow {
    const vat = this.readVat(node.child('СумНал'));
    const excise = this.readExcise(node.child('Акциз'));
    const extraNode = node.child('ДопСведТов');
    const extra: UpdRowExtra = {
      productKind: this.acc.attr(extraNode, 'ПрТовРаб'),
      productKindInfo: this.acc.attr(extraNode, 'ДопПризн'),
      orderedQuantity: this.acc.attr(extraNode, 'НадлОтп'),
      characteristic: this.acc.attr(extraNode, 'ХарактерТов'),
      sort: this.acc.attr(extraNode, 'СортТов'),
      series: this.acc.attr(extraNode, 'СерияТов'),
      article: this.acc.attr(extraNode, 'АртикулТов'),
      code: this.acc.attr(extraNode, 'КодТов'),
      gtin: this.acc.attr(extraNode, 'ГТИН'),
      catalogCode: this.acc.attr(extraNode, 'КодКат'),
      productTypeCode: this.acc.attr(extraNode, 'КодВидТов'),
      productCode: this.acc.attr(extraNode, 'КодВидПр'),
      okpd2: this.acc.attr(extraNode, 'КодТовОКПД2'),
      operationInfo: this.acc.attr(extraNode, 'ДопИнфПВидО'),
    };

    const countryNames = (extraNode?.childrenNamed('КрНаимСтрПр') ?? [])
      .map((child) => this.acc.text(child) ?? '')
      .filter(Boolean);

    const customsNumbers: string[] = [];
    for (const declaration of node.childrenNamed('СвДТ')) {
      const number = this.acc.attr(declaration, 'НомерДТ');
      this.acc.attr(declaration, 'КодПроисх');
      if (number) customsNumbers.push(number);
    }

    const marking: { kiz: string[]; packaging: string[]; transportPackaging?: string } = {
      kiz: [],
      packaging: [],
    };
    const traceability: UpdTraceability[] = [];
    if (extraNode) {
      for (const mark of extraNode.childrenNamed('НомСредИдентТов')) {
        const transport = this.acc.attr(mark, 'ИдентТрансУпак');
        if (transport) marking.transportPackaging = transport;
        this.acc.attr(mark, 'КолВедМарк');
        this.acc.attr(mark, 'ПрПартМарк');
        for (const kiz of mark.childrenNamed('КИЗ')) {
          const value = this.acc.text(kiz);
          if (value) marking.kiz.push(value);
        }
        for (const pack of mark.childrenNamed('НомУпак')) {
          const value = this.acc.text(pack);
          if (value) marking.packaging.push(value);
        }
      }
      for (const trace of extraNode.childrenNamed('СведПрослеж')) {
        traceability.push({
          batchNumber: this.acc.attr(trace, 'НомТовПрослеж'),
          unitCode: this.acc.attr(trace, 'ЕдИзмПрослеж'),
          unitName: this.acc.attr(trace, 'НаимЕдИзмПрослеж'),
          quantity: this.acc.attr(trace, 'КолВЕдПрослеж'),
          amountWithoutVat: this.acc.attr(trace, 'СтТовБезНДСПрослеж'),
          info: this.acc.attr(trace, 'ДопИнфПрослеж'),
        });
      }
    }

    const accessoryDocuments = (extraNode?.childrenNamed('СопрДокТов') ?? []).map((doc) => this.readDocRef(doc));

    const info = node
      .childrenNamed('ИнфПолФХЖ2')
      .map((child) => ({
        id: this.acc.attr(child, 'Идентиф') ?? '',
        value: this.acc.attr(child, 'Значен') ?? '',
      }));

    return {
      number: this.acc.attr(node, 'НомСтр') ?? '',
      name: this.acc.attr(node, 'НаимТов'),
      unitName: this.acc.attr(node, 'НаимЕдИзм'),
      unitCode: this.acc.attr(node, 'ОКЕИ_Тов'),
      quantity: this.acc.attr(node, 'КолТов'),
      price: this.acc.attr(node, 'ЦенаТов'),
      amountWithoutVat: this.acc.attr(node, 'СтТовБезНДС'),
      vatRate: this.acc.attr(node, 'НалСт') ?? '',
      vatAmount: vat.amount,
      vatNone: vat.none,
      amountWithVat: this.acc.attr(node, 'СтТовУчНал'),
      exciseAmount: excise.amount,
      exciseNone: excise.none,
      countryCode: node.child('СвДТ') ? this.acc.attr(node.child('СвДТ'), 'КодПроисх') : undefined,
      countryNames,
      customsNumbers,
      extra,
      marking: marking as UpdMarking,
      traceability,
      accessoryDocuments,
      info,
    };
  }

  private readTransfer(node: XmlNode): UpdTransfer {
    const operation = node.child('СвПер');
    const personNode = operation?.child('СвЛицПер');
    let person: UpdTransfer['person'];
    if (personNode) {
      const employee = personNode.child('РабОргПрод');
      const other = personNode.child('ИнЛицо');
      if (employee) {
        person = {
          role: 'Работник организации продавца',
          fio: formatFio(employee.child('ФИО'), this.acc),
          position: this.acc.attr(employee, 'Должность'),
          other: this.acc.attr(employee, 'ИныеСвед'),
        };
      } else if (other) {
        const representative = other.child('ПредОргПер');
        const individual = other.child('ФЛПер');
        if (representative) {
          const basisNode = representative.child('ОснПолнПредПер') ?? representative.child('ОснДоверОргПер');
          person = {
            role: 'Представитель организации',
            fio: formatFio(representative.child('ФИО'), this.acc),
            position: this.acc.attr(representative, 'Должность'),
            organization: this.acc.attr(representative, 'НаимОргПер'),
            other: this.acc.attr(representative, 'ИныеСвед'),
            basis: basisNode ? formatDocRef(this.readDocRef(basisNode)) : undefined,
          };
        } else if (individual) {
          person = {
            role: 'Физическое лицо',
            fio: formatFio(individual.child('ФИО'), this.acc),
            basis: individual.child('ОснДоверФЛ')
              ? formatDocRef(this.readDocRef(individual.child('ОснДоверФЛ')!))
              : undefined,
          };
        }
      }
    }

    const transportNode = operation?.child('Тран');
    const transport = transportNode
      ? {
          description: this.acc.attr(transportNode, 'СвТран'),
          incoterms: this.acc.attr(transportNode, 'Инкотермс'),
          incotermsVersion: this.acc.attr(transportNode, 'ВерИнкотермс'),
        }
      : undefined;

    const thingNode = operation?.child('СвПерВещи');
    const thingTransfer = thingNode
      ? {
          date: this.acc.attr(thingNode, 'ДатаПерВещ'),
          description: this.acc.attr(thingNode, 'СвПерВещ'),
          document: thingNode.child('ДокПерВещ') ? this.readDocRef(thingNode.child('ДокПерВещ')!) : undefined,
        }
      : undefined;

    const bases = (operation?.childrenNamed('ОснПер') ?? []).map((doc) => this.readDocRef(doc));
    const noBasisNode = operation?.child('БезДокОснПер');
    const withoutBasisDocument = noBasisNode ? Boolean(this.acc.text(noBasisNode)) : undefined;

    return {
      operationContent: this.acc.attr(operation, 'СодОпер'),
      operationType: this.acc.attr(operation, 'ВидОпер'),
      date: this.acc.attr(operation, 'ДатаПер'),
      periodStart: this.acc.attr(operation, 'ДатаНачПер'),
      periodEnd: this.acc.attr(operation, 'ДатаОконПер'),
      bases,
      withoutBasisDocument,
      person,
      transport,
      thingTransfer,
      info: this.readInfoFields(node.child('ИнфПолФХЖ3')),
    };
  }

}

function formatDocRef(doc: DocumentRef): string {
  return [`${doc.kind ?? 'Документ'} № ${doc.number ?? '—'}`, doc.date ? `от ${doc.date}` : undefined]
    .filter(Boolean)
    .join(' ');
}

function sumRows(rows: readonly UpdRow[], field: 'amountWithoutVat' | 'vatAmount' | 'amountWithVat'): string | undefined {
  const values = rows.map((row) => row[field]).filter((value): value is string => value !== undefined);
  if (values.length === 0 || values.length !== rows.length) return undefined;
  const total = sumDecimals(values);
  return total ? total.toFixed(2) : undefined;
}

function groupAppendix(
  items: readonly { label: string; path: string; value: string; section: string }[],
): { title: string; rows: { label: string; path: string; value: string }[] }[] {
  const groups = new Map<string, { label: string; path: string; value: string }[]>();
  for (const item of items) {
    const rows = groups.get(item.section) ?? [];
    rows.push({ label: item.label, path: item.path, value: item.value });
    groups.set(item.section, rows);
  }
  return [...groups.entries()].map(([title, rows]) => ({ title, rows }));
}
