import { collectCoverage, summarizeCoverage, type CoverageSummary, type FieldLabelSource } from '../../mapping/coverage';
import { FieldTracker } from '../../mapping/field-tracker';
import type { ParsedXml } from '../../xml-security/xml-tree';
import { XmlAccessor } from '../shared/xml-access';
import { readTorg2Signer } from './torg2.signers';
import type { KeyValue } from './torg2.model';
import type { Torg2Title1Model } from './torg2-title1.model';

/**
 * Maps the TORG-2 seller title (titleIndex=1, КНД 1175015): additional
 * information about the buyer's acceptance document.
 *
 * The title references the buyer's file and states the seller's result. It
 * never recreates goods rows, sums or signatures of the first title.
 */
export class Torg2Title1Mapper {
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
    model: Torg2Title1Model;
    coverage: CoverageSummary;
    warnings: { code: string; message: string }[];
  } {
    const root = parsed.root;
    const document = root.child('Документ');
    if (!document) throw new Error('TORG-2 title 1 adapter received XML without Документ');

    const sourceId = this.acc.attr(root, 'ИдФайл');
    this.acc.attr(root, 'ВерсФорм');
    const programVersion = this.acc.attr(root, 'ВерсПрог', 'technical', 'Версия программы формирования файла');
    this.acc.technical(root.child('СвУчДокОбор'), 'Идентификаторы участников ЭДО; служебные данные, в бланк не выводятся');

    const knd = this.acc.attr(document, 'КНД') ?? '';
    const formedDate = this.acc.attr(document, 'ДатаДок') ?? '';
    const formedTime = this.acc.attr(document, 'ВремДок') ?? '';
    const organization = this.acc.attr(document, 'НаимЭконСубСост') ?? '';
    const organizationBasis = this.acc.attr(document, 'ОснДоверОргСост');

    const referenceNode = document.child('ИдИнфПок');
    const fileId = this.acc.attr(referenceNode, 'ИдФайлИнфПок') ?? '';
    const referenceDate = this.acc.attr(referenceNode, 'ДатаФайлИнфПок');
    const referenceTime = this.acc.attr(referenceNode, 'ВремФайлИнфПок');

    let signatureCount = 0;
    for (const signature of referenceNode?.childrenNamed('ЭП') ?? []) {
      // The base64 signature is technical: it is neither printed nor verified.
      this.acc.text(signature, 'technical', 'Электронная подпись исходного файла; не проверяется и не печатается');
      signatureCount += 1;
    }

    const resultNode = document.child('СвИтПрием');
    const resultDate = this.acc.attr(resultNode, 'ДатаСвИтПрием');
    const resultContent = this.acc.attr(resultNode, 'СодСвИтПрием');
    const info = this.readInfoFields(resultNode?.child('ИнфПол'));

    const signers = document.childrenNamed('Подписант').map((node) => readTorg2Signer(this.acc, node));

    const firstPass = collectCoverage(root, this.tracker, this.labels);
    const appendixRows = firstPass.filter((item) => item.status === 'unmapped' || item.status === 'appendix');
    for (const item of appendixRows) this.tracker.mark(item.key, 'appendix');
    const coverage = summarizeCoverage(collectCoverage(root, this.tracker, this.labels));

    const appendix = groupAppendix(appendixRows);

    const model: Torg2Title1Model = {
      meta: {
        family: 'Torg2',
        titleIndex: 1,
        workflowFunction: 'WithAdditionalInfo',
        formatVersion: this.formatVersion,
        operatorVersion: this.operatorVersion,
        schemaRevision: this.schemaRevision,
        knd,
        sourceId,
        programVersion,
        formedDate,
        formedTime,
        organization,
        organizationBasis,
        sourceSha256: this.sourceSha256,
        templateVersion: this.templateVersion,
      },
      reference: {
        fileId,
        formedDate: referenceDate,
        formedTime: referenceTime,
        signatureCount,
      },
      results: { date: resultDate, content: resultContent, info },
      signers,
      appendix,
      coverage,
    };

    const warnings: { code: string; message: string }[] = [];
    if (signatureCount === 0) {
      warnings.push({
        code: 'REFERENCED_FILE_WITHOUT_SIGNATURE',
        message: 'The referenced buyer file has no ЭП element in this XML; nothing about a signature is printed',
      });
    }

    return { model, coverage, warnings };
  }

  private readInfoFields(node: import('../../xml-security/xml-tree').XmlNode | undefined): KeyValue[] {
    if (!node) return [];
    this.acc.attr(node, 'ИдФайлИнфПол', 'technical', 'Идентификатор информационного поля');
    return node.childrenNamed('ТекстИнф').map((child) => ({
      id: this.acc.attr(child, 'Идентиф') ?? '',
      value: this.acc.attr(child, 'Значен') ?? '',
    }));
  }
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
