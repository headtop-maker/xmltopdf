import Decimal from 'decimal.js';
import type { ParsedXml, XmlNode } from '../../xml-security/xml-tree';
import type { BusinessIssue, BusinessReport } from '../../validation/business-report';
import { isRuDate, parseDecimal } from '../shared/format';

export const UPD_BUSINESS_RULES_VERSION = 'upd-business-v1';

function rateFraction(rate: string | undefined): Decimal | undefined {
  if (!rate) return undefined;
  const value = rate.trim().replace(',', '.');
  const percent = /^(\d+(?:[.,]\d+)?)%$/.exec(value);
  if (percent) return new Decimal(percent[1].replace(',', '.')).div(100);
  const fraction = /^(\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/.exec(value);
  if (fraction) {
    const denominator = new Decimal(fraction[2].replace(',', '.'));
    if (denominator.isZero()) return undefined;
    return new Decimal(fraction[1].replace(',', '.')).div(denominator);
  }
  return undefined;
}

function nearlyEqual(a: Decimal | undefined, b: Decimal | undefined, tolerance = 0.02): boolean {
  if (a === undefined || b === undefined) return false;
  return a.minus(b).abs().lte(tolerance);
}

function vatValue(node: XmlNode | undefined): Decimal | undefined {
  const value = node?.child('СумНал') ?? node?.child('СумНалВсего')?.child('СумНал');
  return parseDecimal(value?.textValue());
}

/**
 * Versioned business checks for UPD title 0.
 *
 * The rules never recalculate printed values: arithmetic discrepancies and
 * function/content mismatches are warnings, because the converter must not
 * "fix" a primary accounting document.
 */
export function validateUpdBusiness(parsed: ParsedXml): BusinessReport {
  const issues: BusinessIssue[] = [];
  const document = parsed.root.child('Документ');
  if (!document) {
    return {
      version: UPD_BUSINESS_RULES_VERSION,
      status: 'failed',
      issues: [{ code: 'DOCUMENT_MISSING', message: 'Документ element is missing' }],
    };
  }

  const fn = document.getAttribute('Функция');
  const invoice = document.child('СвСчФакт');
  if (!invoice) {
    return {
      version: UPD_BUSINESS_RULES_VERSION,
      status: 'failed',
      issues: [{ code: 'INVOICE_SECTION_MISSING', message: 'СвСчФакт element is missing' }],
    };
  }

  if (!fn || !['СЧФ', 'ДОП', 'СЧФДОП', 'СвРК', 'СвЗК'].includes(fn)) {
    issues.push({
      code: 'UNSUPPORTED_FUNCTION',
      message: `Функция "${fn ?? '(missing)'}" cannot be interpreted as an invoice or shipment document`,
      path: '/Файл/Документ/@Функция',
    });
  }

  const transfer = document.child('СвПродПер');
  if (fn === 'СЧФ' && transfer) {
    issues.push({
      code: 'TRANSFER_DATA_IN_INVOICE',
      message: 'Функция=СЧФ, но присутствует СвПродПер: данные отгрузки не печатаются как часть счёта-фактуры',
      path: '/Файл/Документ/СвПродПер',
    });
  }
  if ((fn === 'СЧФДОП' || fn === 'ДОП') && !transfer) {
    issues.push({
      code: 'TRANSFER_SECTION_MISSING',
      message: `Функция=${fn}, но раздел СвПродПер отсутствует`,
      path: '/Файл/Документ',
    });
  }

  const table = document.child('ТаблСчФакт');
  if ((fn === 'СЧФ' || fn === 'СЧФДОП' || fn === 'СвРК' || fn === 'СвЗК') && !table) {
    issues.push({
      code: 'INVOICE_TABLE_MISSING',
      message: `Функция=${fn}, но ТаблСчФакт отсутствует`,
      path: '/Файл/Документ',
    });
  }

  const checkDate = (node: XmlNode | undefined, attribute: string, path: string): void => {
    const value = node?.getAttribute(attribute);
    if (value !== undefined && !isRuDate(value)) {
      issues.push({
        code: 'INVALID_DATE_FORMAT',
        message: `${attribute} is not in dd.mm.yyyy format: "${value}"`,
        path,
      });
    }
  };
  checkDate(invoice, 'ДатаДок', '/Файл/Документ/СвСчФакт');
  checkDate(document.child('СвПродПер')?.child('СвПер'), 'ДатаПер', '/Файл/Документ/СвПродПер/СвПер');

  const rows = table?.childrenNamed('СведТов') ?? [];
  let sumWithoutVat = new Decimal(0);
  let sumVat = new Decimal(0);
  let sumWithVat = new Decimal(0);
  let completeTotals = true;

  rows.forEach((row, index) => {
    const path = `/Файл/Документ/ТаблСчФакт/СведТов[${index + 1}]`;
    const quantity = parseDecimal(row.getAttribute('КолТов'));
    const price = parseDecimal(row.getAttribute('ЦенаТов'));
    const withoutVat = parseDecimal(row.getAttribute('СтТовБезНДС'));
    const withVat = parseDecimal(row.getAttribute('СтТовУчНал'));
    const vat = vatValue(row.child('СумНал'));

    if (quantity && price && withoutVat) {
      const expected = quantity.times(price);
      if (!nearlyEqual(expected, withoutVat)) {
        issues.push({
          code: 'ARITHMETIC_AMOUNT_MISMATCH',
          message:
            `quantity × price = ${expected.toFixed(2)} but СтТовБезНДС = ${withoutVat.toFixed(2)}; ` +
            'the source value is printed unchanged',
          path,
        });
      }
    }
    if (withoutVat && vat && withVat) {
      const expected = withoutVat.plus(vat);
      if (!nearlyEqual(expected, withVat)) {
        issues.push({
          code: 'ARITHMETIC_TOTAL_MISMATCH',
          message:
            `СтТовБезНДС + НДС = ${expected.toFixed(2)} but СтТовУчНал = ${withVat.toFixed(2)}; ` +
            'the source value is printed unchanged',
          path,
        });
      }
    }
    if (withoutVat && vat && withoutVat.greaterThan(0)) {
      const rate = rateFraction(row.getAttribute('НалСт') ?? undefined);
      if (rate) {
        const actual = vat.div(withoutVat);
        if (actual.minus(rate).abs().greaterThan(0.006)) {
          issues.push({
            code: 'VAT_RATE_MISMATCH',
            message:
              `VAT ${vat.toFixed(2)} is ${actual.times(100).toFixed(2)}% of the base, ` +
              `while НалСт declares ${row.getAttribute('НалСт')}`,
            path,
          });
        }
      }
    }

    if (withoutVat && vat && withVat) {
      sumWithoutVat = sumWithoutVat.plus(withoutVat);
      sumVat = sumVat.plus(vat);
      sumWithVat = sumWithVat.plus(withVat);
    } else {
      completeTotals = false;
    }
  });

  const totals = table?.child('ВсегоОпл');
  if (completeTotals && totals) {
    const declaredWithoutVat = parseDecimal(totals.getAttribute('СтТовБезНДСВсего'));
    const declaredWithVat = parseDecimal(totals.getAttribute('СтТовУчНалВсего'));
    const declaredVat = vatValue(totals);
    if (declaredWithoutVat && !nearlyEqual(declaredWithoutVat, sumWithoutVat)) {
      issues.push({
        code: 'TOTALS_MISMATCH',
        message: `ВсегоОпл/СтТовБезНДСВсего (${declaredWithoutVat.toFixed(2)}) differs from the row sum (${sumWithoutVat.toFixed(2)})`,
        path: '/Файл/Документ/ТаблСчФакт/ВсегоОпл',
      });
    }
    if (declaredVat && !nearlyEqual(declaredVat, sumVat)) {
      issues.push({
        code: 'TOTALS_MISMATCH',
        message: `ВсегоОпл/СумНалВсего (${declaredVat.toFixed(2)}) differs from the row sum (${sumVat.toFixed(2)})`,
        path: '/Файл/Документ/ТаблСчФакт/ВсегоОпл',
      });
    }
    if (declaredWithVat && !nearlyEqual(declaredWithVat, sumWithVat)) {
      issues.push({
        code: 'TOTALS_MISMATCH',
        message: `ВсегоОпл/СтТовУчНалВсего (${declaredWithVat.toFixed(2)}) differs from the row sum (${sumWithVat.toFixed(2)})`,
        path: '/Файл/Документ/ТаблСчФакт/ВсегоОпл',
      });
    }
  }

  const failed = issues.some(
    (issue) => issue.code === 'DOCUMENT_MISSING' || issue.code === 'INVOICE_SECTION_MISSING',
  );
  return {
    version: UPD_BUSINESS_RULES_VERSION,
    status: failed ? 'failed' : issues.length > 0 ? 'passed-with-warnings' : 'passed',
    issues,
  };
}
