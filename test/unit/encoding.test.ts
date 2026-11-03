import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { decodeXmlBytes } from '../../src/xml-security/encoding';

const config = loadConfig();
const cp1251Sample = readFileSync('test/fixtures/torg2.xml');

function encode(text: string, encoding: 'utf-8' | 'utf-16le' | 'utf-16be', bom: boolean): Buffer {
  if (encoding === 'utf-8') {
    const body = Buffer.from(text, 'utf8');
    return bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
  }
  const littleEndian = encoding === 'utf-16le';
  const body = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (littleEndian) {
      body[i * 2] = code & 0xff;
      body[i * 2 + 1] = code >> 8;
    } else {
      body[i * 2] = code >> 8;
      body[i * 2 + 1] = code & 0xff;
    }
  }
  if (!bom) return body;
  return Buffer.concat([Buffer.from(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]), body]);
}

describe('decodeXmlBytes', () => {
  it('decodes the pinned windows-1251 sample with its declared encoding', () => {
    const decoded = decodeXmlBytes(cp1251Sample, config.limits.maxDecodedBytes);
    expect(decoded.encoding).toBe('windows-1251');
    expect(decoded.hadBom).toBe(false);
    expect(decoded.text).toContain('Мука пшеничная хлебопекарная');
    expect(decoded.text).toContain('ФЛАГМАН');
  });

  it('accepts UTF-8 with and without BOM', () => {
    const text = '<?xml version="1.0" encoding="utf-8"?><Файл ВерсФорм="5.01"/>';
    expect(decodeXmlBytes(Buffer.from(text, 'utf8'), config.limits.maxDecodedBytes).encoding).toBe('utf-8');
    expect(decodeXmlBytes(encode(text, 'utf-8', true), config.limits.maxDecodedBytes).hadBom).toBe(true);
  });

  it('decodes UTF-16LE and UTF-16BE by BOM and reports the effective encoding', () => {
    const text = '<?xml version="1.0" encoding="utf-16"?><Файл ВерсФорм="5.01"/>';
    const le = decodeXmlBytes(encode(text, 'utf-16le', true), config.limits.maxDecodedBytes);
    expect(le.encoding).toBe('utf-16le');
    expect(le.text).toContain('ВерсФорм');

    const be = decodeXmlBytes(encode(text, 'utf-16be', true), config.limits.maxDecodedBytes);
    expect(be.encoding).toBe('utf-16be');
    expect(be.text).toContain('ВерсФорм');
  });

  it('rejects a declaration that conflicts with an explicit BOM', () => {
    const text = '<?xml version="1.0" encoding="windows-1251"?><Файл/>';
    expect(() => decodeXmlBytes(encode(text, 'utf-8', true), config.limits.maxDecodedBytes)).toThrowError(
      /conflicts with the byte signature/,
    );
  });

  it('rejects an unknown encoding declaration instead of guessing', () => {
    const text = '<?xml version="1.0" encoding="koi8-r"?><Файл/>';
    expect(() => decodeXmlBytes(Buffer.from(text, 'utf8'), config.limits.maxDecodedBytes)).toThrowError(
      /Unsupported XML encoding/,
    );
  });

  it('rejects empty bodies and invalid byte sequences', () => {
    expect(() => decodeXmlBytes(Buffer.alloc(0), config.limits.maxDecodedBytes)).toThrowError(/empty/i);
    expect(() => decodeXmlBytes(Buffer.from([0xff, 0xfe, 0x00]), config.limits.maxDecodedBytes)).toThrow();
  });
});
