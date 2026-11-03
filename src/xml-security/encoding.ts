import { AppError, errors } from '../common/errors';

export type XmlEncoding = 'utf-8' | 'windows-1251' | 'utf-16le' | 'utf-16be';

export interface DecodedXml {
  readonly text: string;
  readonly encoding: XmlEncoding;
  readonly hadBom: boolean;
}

const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf]);
const BOM_UTF16LE = Buffer.from([0xff, 0xfe]);
const BOM_UTF16BE = Buffer.from([0xfe, 0xff]);

function startsWith(buf: Buffer, prefix: Buffer): boolean {
  return buf.length >= prefix.length && buf.subarray(0, prefix.length).equals(prefix);
}

function normalizeEncodingLabel(raw: string): XmlEncoding | null {
  const label = raw.trim().toLowerCase();
  switch (label) {
    case 'utf-8':
    case 'utf8':
      return 'utf-8';
    case 'windows-1251':
    case 'cp1251':
    case 'win-1251':
    case 'x-cp1251':
      return 'windows-1251';
    case 'utf-16':
    case 'utf-16le':
      return 'utf-16le';
    case 'utf-16be':
      return 'utf-16be';
    default:
      return null;
  }
}

interface SniffResult {
  /** Encoding established from BOM or byte signature; null when neither is present. */
  readonly byteEncoding: XmlEncoding | null;
  readonly hadBom: boolean;
  readonly declared: string | null;
}

function readDeclaration(firstBytes: string): string | null {
  const match = /^\uFEFF?<\?xml\s[^>]*?encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(firstBytes);
  return match ? match[1] : null;
}

function sniff(buffer: Buffer): SniffResult {
  if (startsWith(buffer, BOM_UTF8)) {
    return { byteEncoding: 'utf-8', hadBom: true, declared: readDeclaration(buffer.subarray(3, 1024).toString('latin1')) };
  }
  if (startsWith(buffer, BOM_UTF16LE)) {
    return {
      byteEncoding: 'utf-16le',
      hadBom: true,
      declared: readDeclaration(new TextDecoder('utf-16le').decode(buffer.subarray(2, 1024))),
    };
  }
  if (startsWith(buffer, BOM_UTF16BE)) {
    return {
      byteEncoding: 'utf-16be',
      hadBom: true,
      declared: readDeclaration(new TextDecoder('utf-16be').decode(buffer.subarray(2, 1024))),
    };
  }
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x3c && buffer[2] === 0x00 && buffer[3] === 0x3f) {
    return {
      byteEncoding: 'utf-16be',
      hadBom: false,
      declared: readDeclaration(new TextDecoder('utf-16be').decode(buffer.subarray(0, 1024))),
    };
  }
  if (buffer.length >= 4 && buffer[0] === 0x3c && buffer[1] === 0x00 && buffer[2] === 0x3f && buffer[3] === 0x00) {
    return {
      byteEncoding: 'utf-16le',
      hadBom: false,
      declared: readDeclaration(new TextDecoder('utf-16le').decode(buffer.subarray(0, 1024))),
    };
  }
  return { byteEncoding: null, hadBom: false, declared: readDeclaration(buffer.subarray(0, 1024).toString('latin1')) };
}

function sameFamily(a: XmlEncoding, b: XmlEncoding): boolean {
  return a === b || (a.startsWith('utf-16') && b.startsWith('utf-16'));
}

/**
 * Decodes raw request bytes into a Unicode string following XML encoding rules.
 * The HTTP charset header is intentionally ignored: it must not silently change
 * the encoding declared inside the document.
 */
export function decodeXmlBytes(buffer: Buffer, maxDecodedBytes: number): DecodedXml {
  if (buffer.length === 0) throw errors.emptyBody();

  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0xfe && buffer[3] === 0xff) ||
      (buffer[0] === 0xff && buffer[1] === 0xfe && buffer[2] === 0x00 && buffer[3] === 0x00))
  ) {
    throw errors.invalidEncoding('UTF-32 encoded XML is not supported');
  }

  const { byteEncoding, hadBom, declared } = sniff(buffer);

  let effective: XmlEncoding;
  if (declared) {
    const normalized = normalizeEncodingLabel(declared);
    if (!normalized) {
      throw errors.invalidEncoding(`Unsupported XML encoding declaration: "${declared}"`);
    }
    if (byteEncoding && !sameFamily(normalized, byteEncoding)) {
      throw errors.invalidEncoding(
        `XML declaration encoding "${declared}" conflicts with the byte signature (${byteEncoding})`,
      );
    }
    if (normalized.startsWith('utf-16') && !byteEncoding) {
      throw errors.invalidEncoding('UTF-16 documents must carry a BOM or a byte signature');
    }
    effective = declared.trim().toLowerCase() === 'utf-16' && byteEncoding?.startsWith('utf-16') ? byteEncoding : normalized;
  } else if (byteEncoding) {
    effective = byteEncoding;
  } else {
    // XML 1.0 default when neither a BOM/signature nor a declaration is present.
    effective = 'utf-8';
  }

  if (effective.startsWith('utf-16') && !hadBom && byteEncoding === null) {
    throw errors.invalidEncoding('UTF-16 documents must declare their encoding');
  }

  let text: string;
  try {
    const decoder = new TextDecoder(effective, { fatal: true, ignoreBOM: false });
    const bytes = buffer;
    text = decoder.decode(bytes);
  } catch (cause) {
    throw new AppError(400, 'INVALID_ENCODING', `The document cannot be decoded as ${effective}`, {
      cause,
    });
  }

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  if (Buffer.byteLength(text, 'utf8') > maxDecodedBytes) {
    throw errors.limit('Decoded XML exceeds the configured limit');
  }

  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    throw errors.malformedXml('The document contains characters that are not allowed in XML 1.0');
  }

  return { text, encoding: effective, hadBom };
}
