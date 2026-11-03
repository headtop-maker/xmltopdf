import { isRuDate } from '../shared/format';
import type { ParsedXml } from '../../xml-security/xml-tree';
import type { BusinessIssue, BusinessReport } from '../../validation/business-report';

export const TORG2_TITLE1_BUSINESS_RULES_VERSION = 'torg2-title1-business-v1';

export function validateTorg2Title1Business(parsed: ParsedXml): BusinessReport {
  const issues: BusinessIssue[] = [];
  const document = parsed.root.child('Документ');
  if (!document) {
    return {
      version: TORG2_TITLE1_BUSINESS_RULES_VERSION,
      status: 'failed',
      issues: [{ code: 'DOCUMENT_MISSING', message: 'Документ element is missing' }],
    };
  }

  const knd = document.getAttribute('КНД');
  if (knd !== '1175015') {
    issues.push({
      code: 'KND_MISMATCH',
      message: `КНД "${knd ?? '(missing)'}" does not match the additional-information title (1175015)`,
      path: '/Файл/Документ/@КНД',
    });
  }

  const checkDate = (value: string | undefined, path: string): void => {
    if (value !== undefined && !isRuDate(value)) {
      issues.push({ code: 'INVALID_DATE_FORMAT', message: `Date is not dd.mm.yyyy: "${value}"`, path });
    }
  };
  checkDate(document.getAttribute('ДатаДок'), '/Файл/Документ/@ДатаДок');
  const reference = document.child('ИдИнфПок');
  checkDate(reference?.getAttribute('ДатаФайлИнфПок'), '/Файл/Документ/ИдИнфПок/@ДатаФайлИнфПок');
  checkDate(document.child('СвИтПрием')?.getAttribute('ДатаСвИтПрием'), '/Файл/Документ/СвИтПрием/@ДатаСвИтПрием');

  if (reference && !reference.getAttribute('ИдФайлИнфПок')) {
    issues.push({
      code: 'REFERENCE_FILE_ID_MISSING',
      message: 'ИдФайлИнфПок is empty; the additional-information title cannot be linked to the buyer file',
      path: '/Файл/Документ/ИдИнфПок',
    });
  }

  const failed = issues.some((issue) => issue.code === 'DOCUMENT_MISSING' || issue.code === 'KND_MISMATCH');
  return {
    version: TORG2_TITLE1_BUSINESS_RULES_VERSION,
    status: failed ? 'failed' : issues.length > 0 ? 'passed-with-warnings' : 'passed',
    issues,
  };
}
