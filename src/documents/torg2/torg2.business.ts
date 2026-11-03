import Decimal from 'decimal.js';
import type { ParsedXml } from '../../xml-security/xml-tree';
import type { XmlNode } from '../../xml-security/xml-tree';
import { isRuDate, parseDecimal } from '../shared/format';

export const TORG2_BUSINESS_RULES_VERSION = 'torg2-business-v1';

import type { BusinessIssue, BusinessReport } from '../../validation/business-report';

export type { BusinessIssue, BusinessReport };

function rateFraction(rate: string | undefined): Decimal | undefined {
  if (!rate) return undefined;
  const value = rate.trim().replace(',', '.');
  const percent = /^(\d+(?:\.\d+)?)%$/.exec(value);
  if (percent) return new Decimal(percent[1]).div(100);
  const fraction = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(value);
  if (fraction) {
    const denominator = new Decimal(fraction[2]);
    if (denominator.isZero()) return undefined;
    return new Decimal(fraction[1]).div(denominator);
  }
  return undefined;
}

function nearlyEqual(a: Decimal | undefined, b: Decimal | undefined, tolerance = 0.01): boolean {
  if (a === undefined || b === undefined) return false;
  return a.minus(b).abs().lte(tolerance);
}

/**
 * Versioned business checks for the TORG-2 buyer title.
 *
 * These rules never "fix" the source document: arithmetic mismatches and
 * inconsistent dates are reported as warnings and the original values are
 * printed unchanged. A failed status is reserved for documents whose numbers
 * cannot be interpreted at all.
 */
export function validateTorg2Business(parsed: ParsedXml): BusinessReport {
  const issues: BusinessIssue[] = [];
  const document = parsed.root.child('Документ');
  if (!document) {
    return {
      version: TORG2_BUSINESS_RULES_VERSION,
      status: 'failed',
      issues: [{ code: 'DOCUMENT_MISSING', message: 'Документ element is missing' }],
    };
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
  checkDate(document.child('ИдентДокПР'), 'ДатаДокПР', '/Файл/Документ/ИдентДокПР');
  checkDate(document.child('СодФХЖ1')?.child('СвОсмГруз'), 'ДатаОсм', '/Файл/Документ/СодФХЖ1/СвОсмГруз');

  const results = document.child('СодФХЖ2')?.childrenNamed('РезПрием') ?? [];
  results.forEach((rez, index) => {
    const rowPath = `/Файл/Документ/СодФХЖ2/РезПрием[${index + 1}]`;

    for (const [elementName, quantityAttribute] of [
      ['ПоДокум', 'КолТовПрин'],
      ['ПоФакту', 'КолТовПрин'],
    ] as const) {
      const node = rez.child(elementName);
      if (!node) continue;
      const quantity = parseDecimal(node.getAttribute(quantityAttribute));
      const price = parseDecimal(node.getAttribute('ЦенаПрин'));
      const amount = parseDecimal(node.getAttribute('СтоимТовНДСПрин'));
      const vat = parseDecimal(node.getAttribute('СумНДСПрин'));

      if (quantity && price && amount && vat) {
        const expected = quantity.times(price).plus(vat);
        if (!nearlyEqual(expected, amount)) {
          issues.push({
            code: 'ARITHMETIC_AMOUNT_MISMATCH',
            message:
              `${elementName}: quantity × price + VAT = ${expected.toFixed(2)} ` +
              `but СтоимТовНДСПрин = ${amount.toFixed(2)}; the source value is printed unchanged`,
            path: `${rowPath}/${elementName}`,
          });
        }
      }

      if (amount && vat && amount.greaterThan(vat)) {
        const base = amount.minus(vat);
        const rate = rateFraction(node.getAttribute('СтавНДСПрин'));
        if (rate && base.greaterThan(0)) {
          const actual = vat.div(base);
          if (actual.minus(rate).abs().greaterThan(0.005)) {
            issues.push({
              code: 'VAT_RATE_MISMATCH',
              message:
                `${elementName}: VAT ${vat.toFixed(2)} is ${actual.times(100).toFixed(2)}% of the base, ` +
                `while СтавНДСПрин declares ${node.getAttribute('СтавНДСПрин')}`,
              path: `${rowPath}/${elementName}`,
            });
          }
        }
      }
    }

    const docQuantity = parseDecimal(rez.child('ПоДокум')?.getAttribute('КолТовПрин'));
    const factQuantity = parseDecimal(rez.child('ПоФакту')?.getAttribute('КолТовПрин'));
    const shortage = parseDecimal(rez.child('Недостача')?.getAttribute('КолТовРасх'));
    const surplus = parseDecimal(rez.child('Излишки')?.getAttribute('КолТовРасх'));
    if (docQuantity && factQuantity) {
      const expected = factQuantity.plus(shortage ?? 0).minus(surplus ?? 0);
      if (!nearlyEqual(expected, docQuantity, 0.0001)) {
        issues.push({
          code: 'ARITHMETIC_QUANTITY_MISMATCH',
          message:
            `fact + shortage − surplus = ${expected.toFixed(3)} but the document quantity is ` +
            `${docQuantity.toFixed(3)}; the source values are printed unchanged`,
          path: rowPath,
        });
      }
    }
  });

  const failed = issues.some(
    (issue) => issue.code === 'DOCUMENT_MISSING' || issue.code === 'UNPARSEABLE_NUMBER',
  );
  return {
    version: TORG2_BUSINESS_RULES_VERSION,
    status: failed ? 'failed' : issues.length > 0 ? 'passed-with-warnings' : 'passed',
    issues,
  };
}
