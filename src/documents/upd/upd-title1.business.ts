import type { ParsedXml } from '../../xml-security/xml-tree';
import type { BusinessIssue, BusinessReport } from '../../validation/business-report';
import { isRuDate } from '../shared/format';

export const UPD_TITLE1_BUSINESS_RULES_VERSION = 'upd-title1-business-v1';

const SUPPORTED_FUNCTIONS = new Set(['СЧФ', 'ДОП', 'СЧФДОП']);

export function validateUpdTitle1Business(parsed: ParsedXml): BusinessReport {
  const issues: BusinessIssue[] = [];
  const document = parsed.root.child('Документ');
  if (!document) {
    return {
      version: UPD_TITLE1_BUSINESS_RULES_VERSION,
      status: 'failed',
      issues: [{ code: 'DOCUMENT_MISSING', message: 'Документ element is missing' }],
    };
  }

  const content = document.child('СодФХЖ4');
  if (!content) {
    return {
      version: UPD_TITLE1_BUSINESS_RULES_VERSION,
      status: 'failed',
      issues: [{ code: 'CONTENT_SECTION_MISSING', message: 'СодФХЖ4 element is missing' }],
    };
  }

  const fn = content.getAttribute('Функция');
  if (!fn) {
    issues.push({
      code: 'FUNCTION_MISSING',
      message: 'СодФХЖ4/@Функция is missing; the referenced seller document cannot be interpreted',
      path: '/Файл/Документ/СодФХЖ4/@Функция',
    });
  } else if (!SUPPORTED_FUNCTIONS.has(fn)) {
    issues.push({
      code: 'UNSUPPORTED_FUNCTION',
      message: `Функция "${fn}" is not supported for the buyer confirmation`,
      path: '/Файл/Документ/СодФХЖ4/@Функция',
    });
  }

  const checkDate = (value: string | undefined, path: string): void => {
    if (value !== undefined && !isRuDate(value)) {
      issues.push({ code: 'INVALID_DATE_FORMAT', message: `Date is not dd.mm.yyyy: "${value}"`, path });
    }
  };
  checkDate(content.getAttribute('ДатаДокИнфПр'), '/Файл/Документ/СодФХЖ4/@ДатаДокИнфПр');
  checkDate(document.child('СвПрин')?.getAttribute('ДатаПрин'), '/Файл/Документ/СодФХЖ4/СвПрин/@ДатаПрин');
  checkDate(document.getAttribute('ДатаИнфПок'), '/Файл/Документ/@ДатаИнфПок');

  const reference = document.child('ИдИнфПрод');
  if (reference && !reference.getAttribute('ИдФайлИнфПр')) {
    issues.push({
      code: 'REFERENCE_FILE_ID_MISSING',
      message: 'ИдФайлИнфПр is empty; the buyer confirmation cannot be linked to the seller file',
      path: '/Файл/Документ/ИдИнфПрод',
    });
  }

  const failed = issues.some(
    (issue) =>
      issue.code === 'DOCUMENT_MISSING' ||
      issue.code === 'CONTENT_SECTION_MISSING' ||
      issue.code === 'FUNCTION_MISSING',
  );
  return {
    version: UPD_TITLE1_BUSINESS_RULES_VERSION,
    status: failed ? 'failed' : issues.length > 0 ? 'passed-with-warnings' : 'passed',
    issues,
  };
}
