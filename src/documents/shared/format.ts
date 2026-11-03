import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const NBSP = '\u00a0';

export function parseDecimal(raw: string | undefined): Decimal | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim().replace(',', '.');
  if (normalized === '' || !/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  try {
    return new Decimal(normalized);
  } catch {
    return undefined;
  }
}

export function isDecimalString(raw: string | undefined): boolean {
  return parseDecimal(raw) !== undefined;
}

function groupInteger(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export function formatDecimal(raw: string | undefined, minFractionDigits = 0): string | undefined {
  const value = parseDecimal(raw);
  if (value === undefined) return raw?.trim() || undefined;
  // toFixed() without arguments keeps every significant decimal of the source
  // value; trailing zeros are removed only for display.
  const fixed =
    minFractionDigits > 0
      ? value.toFixed(minFractionDigits)
      : value.toFixed().includes('.')
        ? value.toFixed().replace(/\.?0+$/, '')
        : value.toFixed();
  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [integer, fraction] = unsigned.split('.');
  const formatted = fraction ? `${groupInteger(integer)},${fraction}` : groupInteger(integer);
  return negative ? `-${formatted}` : formatted;
}

/** Money keeps two decimals, as in accounting documents; the value itself is never recalculated. */
export function formatMoney(raw: string | undefined): string | undefined {
  return formatDecimal(raw, 2);
}

export function formatQuantity(raw: string | undefined): string | undefined {
  return formatDecimal(raw, 0);
}

export function formatRate(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  return trimmed.replace('.', ',');
}

export function sumDecimals(values: readonly (string | undefined)[]): Decimal | undefined {
  if (values.length === 0) return undefined;
  let total = new Decimal(0);
  for (const value of values) {
    const parsed = parseDecimal(value);
    if (parsed === undefined) return undefined;
    total = total.plus(parsed);
  }
  return total;
}

export function formatDecimalValue(value: Decimal | undefined, fixed = 2): string | undefined {
  if (value === undefined) return undefined;
  return formatDecimal(value.toFixed(fixed), fixed);
}

export function formatDate(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** dd.mm.yyyy, the only date form used by these formats. */
export function isRuDate(raw: string | undefined): boolean {
  if (!raw) return false;
  return /^\d{2}\.\d{2}\.\d{4}$/.test(raw.trim());
}

export function joinNonEmpty(parts: readonly (string | undefined | null)[], separator = ', '): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(separator);
}

export function formatApproxEqual(a: Decimal | undefined, b: Decimal | undefined, tolerance = 0.01): boolean {
  if (a === undefined || b === undefined) return false;
  return a.minus(b).abs().lte(tolerance);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
