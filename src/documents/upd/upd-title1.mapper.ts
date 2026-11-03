import { collectCoverage, summarizeCoverage, type CoverageSummary, type FieldLabelSource } from '../../mapping/coverage';
import { FieldTracker } from '../../mapping/field-tracker';
import { XmlNode, type ParsedXml } from '../../xml-security/xml-tree';
import { formatFio } from '../shared/party';
import { XmlAccessor } from '../shared/xml-access';
import type { DocumentRef, KeyValue } from '../torg2/torg2.model';
import { readUpdSigner } from './upd.signers';
import type { UpdTitle1Model } from './upd-title1.model';

const PROCUREMENT_FIELDS: Record<string, string> = {
  ИдКодЗак: 'Идентификационный код закупки',
  ЛицСчетПок: 'Номер лицевого счёта покупателя',
  НаимФинОргПок: 'Наименование финансового органа покупателя',
  НомРеестрЗапПок: 'Номер реестровой записи покупателя',
  УчНомБюдОбязПок: 'Учётный номер бюджетного обязательства',
  КодКазначПок: 'Код территориального органа Федерального казначейства',
  НаимКазначПок: 'Наименование территориального органа Федерального казначейства',
  ОКТМОПок: 'ОКТМО покупателя',
  ОКТМОМесПост: 'ОКТМО места поставки',
  ДатаОплПред: 'Предельная дата оплаты',
  УчНомДенОбяз: 'Учётный номер денежного обязательства',
  ОчерПлат: 'Очерёдность платежа',
  ВидПлат: 'Вид платежа',
};

/**
 * Maps the UPD buyer title (titleIndex=1, КНД 1115132): confirmation of
 * receipt of the seller's shipment document.
 *
 * The title contains no goods table of its own and never recreates the seller's
 * rows or totals. It reports the referenced file, the acceptance result and its
 * own signers; the fact of signing is not verified.
 */
export class UpdTitle1Mapper {
  private readonly tracker = new FieldTracker();
  private readonly acc = new XmlAccessor(this.tracker);

  constructor(
    private readonly labels: FieldLabelSource,
    private readonly sourceSha256: string,
    private readonly schemaRevision: string,
    private readonly formatVersion: string,
    private readonly operatorVersion: string,
    private readonly templateVersion: string,
  ) {}

  map(parsed: ParsedXml): {
    model: UpdTitle1Model;
    coverage: CoverageSummary;
    warnings: { code: string; message: string }[];
  } {
    const root = parsed.root;
    const document = root.child('Документ');
    if (!document) throw new Error('UPD title 1 adapter received XML without Документ');

    const sourceId = this.acc.attr(root, 'ИдФайл');
    this.acc.attr(root, 'ВерсФорм');
    const programVersion = this.acc.attr(root, 'ВерсПрог', 'technical', 'Версия программы формирования файла');

    const knd = this.acc.attr(document, 'КНД') ?? '';
    const documentUid = this.acc.attr(document, 'УИД');
    const formedDate = this.acc.attr(document, 'ДатаИнфПок') ?? '';
    const formedTime = this.acc.attr(document, 'ВремИнфПок') ?? '';
    const organization = this.acc.attr(document, 'НаимЭконСубСост') ?? '';

    const referenceNode = document.child('ИдИнфПрод');
    const sellerFileId = this.acc.attr(referenceNode, 'ИдФайлИнфПр') ?? '';
    const referenceDate = this.acc.attr(referenceNode, 'ДатаФайлИнфПр');
    const referenceTime = this.acc.attr(referenceNode, 'ВремФайлИнфПр');
    let signatureCount = 0;
    for (const signature of referenceNode?.childrenNamed('ЭП') ?? []) {
      this.acc.text(signature, 'technical', 'Электронная подпись исходного файла продавца; не проверяется и не печатается');
      signatureCount += 1;
    }

    const contentNode = document.child('СодФХЖ4');
    const content = {
      documentName: this.acc.attr(contentNode, 'НаимДокОпрПр'),
      function: this.acc.attr(contentNode, 'Функция'),
      documentNumber: this.acc.attr(contentNode, 'ПорНомДокИнфПр'),
      documentDate: this.acc.attr(contentNode, 'ДатаДокИнфПр'),
      operationType: this.acc.attr(contentNode, 'ВидОпер'),
    };

    const acceptanceNode = contentNode?.child('СвПрин');
    const codeNode = acceptanceNode?.child('КодСодОпер');
    const discrepancyNode = codeNode?.child('РеквДокРасх');
    const personNode = acceptanceNode?.child('СвЛицПрин');
    let person: UpdTitle1Model['acceptance']['person'];
    if (personNode) {
      const employee = personNode.child('РабОргПок');
      const other = personNode.child('ИнЛицо');
      if (employee) {
        person = {
          role: 'Работник организации покупателя',
          fio: formatFio(employee.child('ФИО'), this.acc),
          position: this.acc.attr(employee, 'Должность'),
          other: this.acc.attr(employee, 'ИныеСвед'),
        };
      } else if (other) {
        const representative = other.child('ПредОргПрин');
        const individual = other.child('ФЛПрин');
        if (representative) {
          person = {
            role: 'Представитель организации',
            fio: formatFio(representative.child('ФИО'), this.acc),
            position: this.acc.attr(representative, 'Должность'),
            organization: this.acc.attr(representative, 'НаимОргПрин'),
            inn: this.acc.attr(representative, 'ИННОргПрин'),
            other: this.acc.attr(representative, 'ИныеСвед'),
            basis: representative.child('ОснПолнПредПрин')
              ? formatDocRef(this.readDocRef(representative.child('ОснПолнПредПрин')!))
              : representative.child('ОснДоверОргПрин')
                ? formatDocRef(this.readDocRef(representative.child('ОснДоверОргПрин')!))
                : undefined,
          };
        } else if (individual) {
          person = {
            role: 'Физическое лицо',
            fio: formatFio(individual.child('ФИО'), this.acc),
            inn: this.acc.attr(individual, 'ИННФЛПрин'),
            other: this.acc.attr(individual, 'ИныеСвед'),
            basis: individual.child('ОснДоверФЛ')
              ? formatDocRef(this.readDocRef(individual.child('ОснДоверФЛ')!))
              : undefined,
          };
        }
      }
    }

    const acceptance = {
      operation: this.acc.attr(acceptanceNode, 'СодОпер'),
      date: this.acc.attr(acceptanceNode, 'ДатаПрин'),
      resultCode: this.acc.attr(codeNode, 'КодИтога'),
      discrepancyDocument: discrepancyNode ? this.readDocRef(discrepancyNode) : undefined,
      person,
    };

    const procurement: KeyValue[] = [];
    const procurementNode = document.child('ИнфПокЗаГоскКазн');
    if (procurementNode) {
      for (const [attribute, label] of Object.entries(PROCUREMENT_FIELDS)) {
        const value = this.acc.attr(procurementNode, attribute);
        if (value) procurement.push({ id: label, value });
      }
    }

    const infoNode = contentNode?.child('ИнфПолФХЖ4');
    const info: KeyValue[] = [];
    if (infoNode) {
      this.acc.attr(infoNode, 'ИдФайлИнфПол', 'technical', 'Идентификатор информационного поля');
      for (const text of infoNode.childrenNamed('ТекстИнф')) {
        info.push({
          id: this.acc.attr(text, 'Идентиф') ?? '',
          value: this.acc.attr(text, 'Значен') ?? '',
        });
      }
    }

    const authorityNode = document.child('ОснДоверОргСост');
    const authorityBasis = authorityNode ? this.readDocRef(authorityNode) : undefined;

    const signers = document.childrenNamed('Подписант').map((node) => readUpdSigner(this.acc, node));

    const firstPass = collectCoverage(root, this.tracker, this.labels);
    const appendixRows = firstPass.filter((item) => item.status === 'unmapped' || item.status === 'appendix');
    for (const item of appendixRows) this.tracker.mark(item.key, 'appendix');
    const coverage = summarizeCoverage(collectCoverage(root, this.tracker, this.labels));
    const appendix = groupAppendix(appendixRows);

    const model: UpdTitle1Model = {
      meta: {
        family: 'UniversalTransferDocument',
        titleIndex: 1,
        function: content.function ?? '',
        formatVersion: this.formatVersion,
        operatorVersion: this.operatorVersion,
        schemaRevision: this.schemaRevision,
        knd,
        sourceId,
        documentUid,
        programVersion,
        formedDate,
        formedTime,
        organization,
        sourceSha256: this.sourceSha256,
        templateVersion: this.templateVersion,
      },
      reference: {
        sellerFileId,
        formedDate: referenceDate,
        formedTime: referenceTime,
        signatureCount,
      },
      content,
      acceptance,
      procurement,
      info,
      authorityBasis,
      signers,
      appendix,
      coverage,
    };

    const warnings: { code: string; message: string }[] = [];
    if (signatureCount === 0) {
      warnings.push({
        code: 'REFERENCED_FILE_WITHOUT_SIGNATURE',
        message: 'The referenced seller file has no ЭП element in this XML; nothing about a signature is printed',
      });
    }

    return { model, coverage, warnings };
  }

  private readDocRef(node: XmlNode): DocumentRef {
    return {
      kind: this.acc.attr(node, 'РеквНаимДок'),
      number: this.acc.attr(node, 'РеквНомерДок'),
      date: this.acc.attr(node, 'РеквДатаДок'),
      additionalId: this.acc.attr(node, 'РеквИдФайлДок') ?? this.acc.attr(node, 'РеквИдДок'),
    };
  }
}

function formatDocRef(doc: DocumentRef): string {
  return [`${doc.kind ?? 'Документ'} № ${doc.number ?? '—'}`, doc.date ? `от ${doc.date}` : undefined]
    .filter(Boolean)
    .join(' ');
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
