import { collectCoverage, summarizeCoverage, type CoverageSummary, type FieldLabelSource } from '../../mapping/coverage';
import type { ParsedXml } from '../../xml-security/xml-tree';
import { XmlNode } from '../../xml-security/xml-tree';
import {
  formatMoney,
  formatQuantity,
  parseDecimal,
  sumDecimals,
} from '../shared/format';
import { readParty, formatFio, type PartyModel } from '../shared/party';
import { XmlAccessor } from '../shared/xml-access';
import { FieldTracker } from '../../mapping/field-tracker';
import { readTorg2Signer } from './torg2.signers';
import type {
  Amounts,
  AppendixGroup,
  AppendixRow,
  Discrepancy,
  DocumentRef,
  GoodsRow,
  KeyValue,
  PartyBlock,
  PriceDelta,
  Torg2PrintModel,
  Torg2Totals,
  TotalsBlock,
  TransportDocument,
} from './torg2.model';

const ADDITIONAL_INFO_CODES: Record<string, string> = {
  '1': 'дополнительные сведения к документу сформированы (титул с КНД 1175015)',
  '2': 'дополнительные сведения к документу сформированы (титул с КНД 1175015), код 2',
};

const TIMELINE_LABELS: Record<string, string> = {
  ПрибГруз: 'Прибытие на место назначения',
  ВыдачГруз: 'Выдача груза транспортной организацией',
  ВскрытГруз: 'Вскрытие вагона (транспортного средства)',
  ДостГруз: 'Доставка на склад получателя',
};

/**
 * Maps a TORG-2 buyer title (titleIndex=0) onto the print model.
 *
 * Main fields are mapped explicitly. Everything else that carries data is
 * emitted into the appendix of the same PDF, so no source value silently
 * disappears; coverage is computed from the actual XML nodes and attributes.
 */
export class Torg2Mapper {
  private readonly tracker = new FieldTracker();
  private readonly acc = new XmlAccessor(this.tracker);

  constructor(
    private readonly labels: FieldLabelSource,
    private readonly sourceSha256: string,
    private readonly schemaRevision: string,
    private readonly formatVersion: string,
    private readonly operatorVersion: string,
    private readonly templateVersion: string,
    private readonly maxGoodsRows: number,
  ) {}

  map(parsed: ParsedXml): {
    model: Torg2PrintModel;
    coverage: CoverageSummary;
    warnings: { code: string; message: string }[];
  } {
    const warnings: { code: string; message: string }[] = [];
    const root = parsed.root;
    const document = root.child('Документ');
    if (!document) throw new Error('TORG-2 adapter received XML without Документ');

    const sourceId = this.acc.attr(root, 'ИдФайл');
    this.acc.attr(root, 'ВерсФорм');
    root.child('СвУчДокОбор')?.walk((node) => {
      this.acc.technical(node, 'Идентификаторы участников ЭДО; служебные данные, в бланк не выводятся');
    });
    const programVersion = this.acc.attr(root, 'ВерсПрог', 'technical', 'Версия программы формирования файла');
    const knd = this.acc.attr(document, 'КНД') ?? '';

    const formedDate = this.acc.attr(document, 'ДатаИнфПок');
    const formedTime = this.acc.attr(document, 'ВремИнфПок');
    const actKind = this.acc.attr(document, 'НаимДокОпр');
    const factDescription = this.acc.attr(document, 'ПоФактХЖ');
    const organization = this.acc.attr(document, 'НаимЭконСубСост') ?? '';
    const organizationBasis = this.acc.attr(document, 'ОснДоверОргСост', 'rendered');
    const documentCircumstances = this.acc.attr(document, 'ОбстСостДок');
    const additionalInfoPurpose = this.acc.attr(document, 'НазнДопСв');

    const identity = document.child('ИдентДокПР');
    const documentNumber = this.acc.attr(identity, 'НомДокПР') ?? '';
    const documentDate = this.acc.attr(identity, 'ДатаДокПР') ?? '';

    const correction = document.child('ИспрДокПР');
    const correctionNumber = this.acc.attr(correction, 'НомИспрДокПР');
    const correctionDate = this.acc.attr(correction, 'ДатаИспрДокПР');

    const body = document.child('СодФХЖ1');
    const content = document.child('СодФХЖ2');

    if (!body || !content) {
      throw new Error('TORG-2 adapter received an unexpected document structure');
    }

    const parties: PartyBlock = {
      seller: this.readPartyNode(body.child('Продавец')),
      buyer: this.readPartyNode(body.child('Покупатель')),
      shipper: this.readPartyNode(body.child('Грузоотправитель')),
      consignee: this.readPartyNode(body.child('Грузополучатель')),
      insurer: this.readPartyNode(body.child('СтрахКом')),
    };

    const order = body.child('Приказ');
    const basis = {
      orderDate: this.acc.attr(order, 'ДатаПрик'),
      orderNumber: this.acc.attr(order, 'НомПрик'),
      gosContractId: this.acc.attr(body, 'ИдГосКон'),
      operationCode: this.acc.attr(body, 'ОбстИсп'),
    };

    const inspection = this.readInspection(body, parties);

    const eventDescription = this.acc.attr(content, 'СодСоб');
    const conclusion = this.acc.attr(content, 'Заключение');
    const operationType = this.acc.attr(content, 'ВидОперации');

    const results = content.childrenNamed('РезПрием');
    if (results.length > this.maxGoodsRows) {
      warnings.push({
        code: 'GOODS_ROWS_OVER_LIMIT',
        message: `Document declares ${results.length} goods rows (limit ${this.maxGoodsRows})`,
      });
    }
    const rows = results.map((node, index) => this.readGoodsRow(node, index + 1));

    const attachments: DocumentRef[] = content
      .childrenNamed('ПрилДок')
      .map((node) => ({
        kind: this.acc.attr(node, 'ВидПрилДок'),
        number: this.acc.attr(node, 'НомерПрилДок'),
        date: this.acc.attr(node, 'ДатаПрилДок'),
      }));

    const additionalInfoCodes = document
      .childrenNamed('ИнфДопСв')
      .map((node) => this.acc.text(node) ?? '')
      .filter((value) => value !== '')
      .map((code) => (ADDITIONAL_INFO_CODES[code] ? `Код ${code}: ${ADDITIONAL_INFO_CODES[code]}` : `Код ${code}`));

    const signers = document.childrenNamed('Подписант').map((node) => readTorg2Signer(this.acc, node));

    const totals = this.computeTotals(rows);
    const eventInfo = this.readInfoFieldsList(content.childrenNamed('ИнфПолФХЖ2'));

    const firstPass = collectCoverage(root, this.tracker, this.labels);
    const appendixRows = firstPass.filter(
      (item) => item.status === 'unmapped' || item.status === 'appendix',
    );
    for (const item of appendixRows) this.tracker.mark(item.key, 'appendix');
    const coverage = summarizeCoverage(collectCoverage(root, this.tracker, this.labels));

    const appendix = groupAppendix(appendixRows);

    const model: Torg2PrintModel = {
      meta: {
        family: 'Torg2',
        formatVersion: this.formatVersion,
        operatorVersion: this.operatorVersion,
        schemaRevision: this.schemaRevision,
        knd,
        sourceId,
        programVersion,
        documentNumber,
        documentDate,
        actName: actKind ?? 'Акт об установленном расхождении',
        actKind: factDescription,
        correctionNumber,
        correctionDate,
        formedDate,
        formedTime,
        organization,
        organizationBasis,
        documentCircumstances,
        additionalInfoPurpose,
        additionalInfoCodes,
        sourceSha256: this.sourceSha256,
        templateVersion: this.templateVersion,
      },
      parties,
      basis,
      inspection,
      rows,
      totals,
      event: {
        description: eventDescription,
        conclusion,
        operationType,
        info: eventInfo,
      },
      attachments,
      signers,
      appendix,
      coverage,
    };

    return { model, coverage, warnings };
  }

  private readPartyNode(node: XmlNode | undefined): PartyModel | undefined {
    if (!node) return undefined;
    return readParty(this.acc, node);
  }

  private readInfoFields(node: XmlNode | undefined): KeyValue[] {
    return this.readInfoFieldsList(node ? [node] : []);
  }

  private readInfoFieldsList(nodes: readonly XmlNode[]): KeyValue[] {
    const result: KeyValue[] = [];
    for (const node of nodes) {
      this.acc.attr(node, 'ИдФайлИнфПол', 'technical', 'Идентификатор информационного поля');
      const directId = this.acc.attr(node, 'Идентиф');
      const directValue = this.acc.attr(node, 'Значен');
      if (directId !== undefined || directValue !== undefined) {
        result.push({ id: directId ?? '', value: directValue ?? '' });
      }
      for (const child of node.childrenNamed('ТекстИнф')) {
        result.push({
          id: this.acc.attr(child, 'Идентиф') ?? '',
          value: this.acc.attr(child, 'Значен') ?? '',
        });
      }
    }
    return result;
  }

  private readInspection(body: XmlNode, parties: PartyBlock) {
    const inspectionNode = body.child('СвОсмГруз');
    const timelineNode = body.child('СвВремПрием');
    const timeline: KeyValue[] = [];
    if (timelineNode) {
      for (const [name, label] of Object.entries(TIMELINE_LABELS)) {
        const value = this.acc.attr(timelineNode, name);
        if (value) timeline.push({ id: label, value });
      }
    }

    const transportDocuments: TransportDocument[] = body
      .childrenNamed('СвСопрДок')
      .map((node) => {
        const massDoc = node.child('МассаДок');
        const massFact = node.child('МассаФакт');
        return {
          seals: this.acc.attr(node, 'ОтмПломб'),
          packaging: this.acc.attr(node, 'ВидУпак'),
          places: this.acc.attr(node, 'КолМест'),
          cargoName: this.acc.attr(node, 'НаимГруз'),
          unitCode: this.acc.attr(node, 'ОКЕИ_Тов'),
          unitName: this.acc.attr(node, 'НаимЕдИзм'),
          massDocGross: this.acc.attr(massDoc, 'МассаБр'),
          massDocNet: this.acc.attr(massDoc, 'МассаНет'),
          massFactGross: this.acc.attr(massFact, 'МассаБр'),
          massFactNet: this.acc.attr(massFact, 'МассаНет'),
          info: this.readInfoFields(node.child('ИнфПолСопрДок')),
        };
      });

    const other = body.child('ДрОбстПрием');
    const carrier = this.readPartyNode(other?.child('Перевозчик'));
    if (carrier) parties.carrier = carrier;

    const transportDocNode = other?.child('СопрТрансДок');
    if (transportDocNode) {
      transportDocuments.push({
        name: this.acc.attr(transportDocNode, 'НаимСопрДок'),
        number: this.acc.attr(transportDocNode, 'НомСопрДок'),
        date: this.acc.attr(transportDocNode, 'ДатаСопрДок'),
        additionalId: this.acc.attr(transportDocNode, 'ДопИдСопрДок'),
        info: [],
      });
    }

    const accepted = body.child('СвЛицПрин');
    let acceptedBy: {
      role: string;
      fio?: string;
      position?: string;
      organization?: string;
      basis?: string;
      other?: string;
    } | undefined;
    if (accepted) {
      const employee = accepted.child('РабОргПок');
      const otherPerson = accepted.child('ИнЛицо');
      if (employee) {
        acceptedBy = {
          role: 'Работник организации покупателя',
          fio: formatFio(employee.child('ФИО'), this.acc),
          position: this.acc.attr(employee, 'Должность'),
          basis: this.acc.attr(employee, 'ОснПолн'),
          other: this.acc.attr(employee, 'ИныеСвед'),
        };
      } else if (otherPerson) {
        const representative = otherPerson.child('ПредОргПрин');
        const individual = otherPerson.child('ФЛПрин');
        if (representative) {
          acceptedBy = {
            role: 'Представитель организации, уполномоченной на приёмку',
            fio: formatFio(representative.child('ФИО'), this.acc),
            position: this.acc.attr(representative, 'Должность'),
            organization: this.acc.attr(representative, 'НаимОргПрин'),
            basis: this.acc.attr(representative, 'ОснПолнПредПрин'),
            other: this.acc.attr(representative, 'ОснДоверОргПрин'),
          };
        } else if (individual) {
          acceptedBy = {
            role: 'Физическое лицо, уполномоченное на приёмку',
            fio: formatFio(individual.child('ФИО'), this.acc),
            basis: this.acc.attr(individual, 'ОснДоверФЛ'),
            other: this.acc.attr(individual, 'ИныеСвед'),
          };
        }
      }
    }

    const accompanyingDocuments: DocumentRef[] = [];
    if (inspectionNode) {
      for (const docNode of inspectionNode.childrenNamed('СопрДок')) {
        accompanyingDocuments.push({
          name: this.acc.attr(docNode, 'НаимСопрДок'),
          number: this.acc.attr(docNode, 'НомСопрДок'),
          date: this.acc.attr(docNode, 'ДатаСопрДок'),
          additionalId: this.acc.attr(docNode, 'ДопИдСопрДок'),
        });
      }
    }

    return {
      date: this.acc.attr(inspectionNode, 'ДатаОсм'),
      place: this.acc.attr(inspectionNode, 'МестоСост'),
      timeStart: this.acc.attr(inspectionNode, 'ВремяНач'),
      timeEnd: this.acc.attr(inspectionNode, 'ВремяОконч'),
      shippingDate: this.acc.attr(inspectionNode, 'ДатаОтпр'),
      openingDate: this.acc.attr(timelineNode, 'ВскрытГруз'),
      certificates: inspectionNode
        ? inspectionNode.childrenNamed('СертСоотв').map((node) => this.acc.text(node) ?? '').filter(Boolean)
        : [],
      accompanyingDocuments,
      transportDocuments,
      timeline,
      storageConditions: this.acc.attr(other, 'УсловХран'),
      packagingState: this.acc.attr(other, 'СостТара'),
      shortageMethod: this.acc.attr(other, 'ОпредНедост'),
      otherInfo: this.acc.attr(other, 'ДопСв'),
      acceptedBy,
      info: [
        ...this.readInfoFields(inspectionNode?.child('ИнфПолСвОсм')),
        ...this.readInfoFields(body.child('ИнфПолФХЖ1')),
      ],
    };
  }

  private readAmounts(node: XmlNode | undefined): Amounts | undefined {
    if (!node) return undefined;
    const quantity = this.acc.attr(node, 'КолТовПрин');
    const price = this.acc.attr(node, 'ЦенаПрин');
    const vatRate = this.acc.attr(node, 'СтавНДСПрин');
    const amountWithVat = this.acc.attr(node, 'СтоимТовНДСПрин');
    const vatAmount = this.acc.attr(node, 'СумНДСПрин');
    if (
      quantity === undefined &&
      price === undefined &&
      vatRate === undefined &&
      amountWithVat === undefined &&
      vatAmount === undefined
    ) {
      return undefined;
    }
    return { quantity, price, vatRate, amountWithVat, vatAmount };
  }

  private readDiscrepancy(node: XmlNode | undefined): Discrepancy | undefined {
    if (!node) return undefined;
    return {
      quantity: this.acc.attr(node, 'КолТовРасх'),
      amountWithVat: this.acc.attr(node, 'СтоимТовНДСРасх'),
      vatAmount: this.acc.attr(node, 'СумНДСРасх'),
      note: this.acc.attr(node, 'ПоясненияРасх'),
    };
  }

  private readDelta(node: XmlNode | undefined): PriceDelta | undefined {
    if (!node) return undefined;
    return {
      price: this.acc.attr(node, 'ДельтаЦена'),
      amountWithVat: this.acc.attr(node, 'ДельтаСтоимНДС'),
      vatAmount: this.acc.attr(node, 'ДельтаСумНДС'),
      note: this.acc.attr(node, 'ПояснДельта'),
    };
  }

  private readMarking(node: XmlNode | undefined, target: {
    kiz: string[];
    packaging: string[];
    transportPackaging?: string;
  }): void {
    if (!node) return;
    for (const marking of node.childrenNamed('НомСредИдентТов')) {
      const transport = this.acc.attr(marking, 'ИдентТрансУпак');
      if (transport) target.transportPackaging = target.transportPackaging
        ? `${target.transportPackaging}; ${transport}`
        : transport;
      for (const kiz of marking.childrenNamed('КИЗ')) {
        const value = this.acc.text(kiz);
        if (value) target.kiz.push(value);
      }
      for (const pack of marking.childrenNamed('НомУпак')) {
        const value = this.acc.text(pack);
        if (value) target.packaging.push(value);
      }
    }
  }

  private readGoodsRow(node: XmlNode, number: number): GoodsRow {
    const unitName = this.acc.attr(node, 'НаимЕдИзм');
    const unitCode = this.acc.attr(node, 'ОКЕИ_Тов');
    const discrepancyDescription = this.acc.attr(node, 'РасхРабУслПрав');

    const values = node.child('Ценности');
    const byDocument = this.readAmounts(node.child('ПоДокум'));
    const byFact = this.readAmounts(node.child('ПоФакту'));

    const marking = { kiz: [] as string[], packaging: [] as string[], transportPackaging: undefined as string | undefined };
    this.readMarking(node.child('ПоДокум'), marking);
    this.readMarking(node.child('ПоФакту'), marking);
    this.readMarking(node.child('Недостача'), marking);
    this.readMarking(node.child('Излишки'), marking);
    this.readMarking(node.child('Брак'), marking);
    this.readMarking(node.child('Бой'), marking);

    const priceDeviation = node.child('ЦенОтклон');
    const positiveDeltaNode = priceDeviation?.child('ПолДельта');
    const negativeDeltaNode = priceDeviation?.child('ОтрицатДельта');

    return {
      number,
      sourceLine: this.acc.attr(values, 'НомСтрСопрДок'),
      name: this.acc.attr(values, 'НаимТов') ?? '',
      characteristic: this.acc.attr(values, 'ХарактТов'),
      sort: this.acc.attr(values, 'СортТов'),
      article: this.acc.attr(values, 'АртикулТов'),
      code: this.acc.attr(values, 'КодТов'),
      passport: this.acc.attr(values, 'Паспорт'),
      unitName,
      unitCode,
      byDocument,
      byFact,
      defect: this.readDiscrepancy(node.child('Брак')),
      breakage: this.readDiscrepancy(node.child('Бой')),
      shortage: this.readDiscrepancy(node.child('Недостача')),
      surplus: this.readDiscrepancy(node.child('Излишки')),
      positiveDelta: this.readDelta(positiveDeltaNode),
      negativeDelta: this.readDelta(negativeDeltaNode),
      marking,
      info: [
        ...(discrepancyDescription
          ? [{ id: 'Информация о расхождениях (претензиях)', value: discrepancyDescription }]
          : []),
        ...this.readInfoFieldsList(node.childrenNamed('ИнфПолРезПрием')),
      ],
    };
  }

  private computeTotals(rows: readonly GoodsRow[]): Torg2Totals {
    const loose = (values: readonly (string | undefined)[]): string | undefined => {
      const defined = values.filter((v): v is string => v !== undefined && parseDecimal(v) !== undefined);
      if (defined.length === 0) return undefined;
      const total = sumDecimals(defined);
      if (!total) return undefined;
      return total.toFixed(2);
    };
    const block = (quantity: (string | undefined)[], amount: (string | undefined)[], vat: (string | undefined)[]): TotalsBlock => ({
      quantity: formatQuantity(loose(quantity)),
      amountWithVat: formatMoney(loose(amount)),
      vatAmount: formatMoney(loose(vat)),
    });
    return {
      byDocument: block(
        rows.map((r) => r.byDocument?.quantity),
        rows.map((r) => r.byDocument?.amountWithVat),
        rows.map((r) => r.byDocument?.vatAmount),
      ),
      byFact: block(
        rows.map((r) => r.byFact?.quantity),
        rows.map((r) => r.byFact?.amountWithVat),
        rows.map((r) => r.byFact?.vatAmount),
      ),
      shortage: block(
        rows.map((r) => r.shortage?.quantity),
        rows.map((r) => r.shortage?.amountWithVat),
        rows.map((r) => r.shortage?.vatAmount),
      ),
      surplus: block(
        rows.map((r) => r.surplus?.quantity),
        rows.map((r) => r.surplus?.amountWithVat),
        rows.map((r) => r.surplus?.vatAmount),
      ),
      defect: block(
        rows.map((r) => r.defect?.quantity),
        rows.map((r) => r.defect?.amountWithVat),
        rows.map((r) => r.defect?.vatAmount),
      ),
      breakage: block(
        rows.map((r) => r.breakage?.quantity),
        rows.map((r) => r.breakage?.amountWithVat),
        rows.map((r) => r.breakage?.vatAmount),
      ),
    };
  }
}

function groupAppendix(
  items: readonly {
    label: string;
    path: string;
    value: string;
    section: string;
  }[],
): AppendixGroup[] {
  const groups = new Map<string, AppendixRow[]>();
  for (const item of items) {
    const title = item.section;
    const rows = groups.get(title) ?? [];
    rows.push({ label: item.label, path: item.path, value: item.value });
    groups.set(title, rows);
  }
  return [...groups.entries()].map(([title, rows]) => ({ title, rows }));
}
