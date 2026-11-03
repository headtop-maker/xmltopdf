import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { decodeXmlBytes } from '../../src/xml-security/encoding';
import { XmlParserService } from '../../src/xml-security/xml-parser.service';

const config = loadConfig();
const parser = new XmlParserService(config);

function parse(text: string) {
  return parser.parse(decodeXmlBytes(Buffer.from(text, 'utf8'), config.limits.maxDecodedBytes).text);
}

describe('XmlParserService', () => {
  it('builds an ordered tree with indexed paths and attributes', () => {
    const parsed = parse('<?xml version="1.0"?><Файл ИдФайл="A"><Документ КНД="1"/><Документ КНД="2"/></Файл>');
    expect(parsed.root.name).toBe('Файл');
    const documents = parsed.root.childrenNamed('Документ');
    expect(documents).toHaveLength(2);
    expect(documents[1].uid).toBe('/Файл[1]/Документ[2]');
    expect(documents[1].getAttribute('КНД')).toBe('2');
  });

  it('rejects DTD/DOCTYPE including entity declarations', () => {
    const xml =
      '<?xml version="1.0"?><!DOCTYPE Файл [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Файл>&xxe;</Файл>';
    expect(() => parse(xml)).toThrowError(/DTD|entity/i);
  });

  it('rejects processing instructions', () => {
    expect(() => parse('<?xml version="1.0"?><?php echo 1; ?><Файл/>')).toThrowError(/Processing instruction/);
  });

  it('rejects undefined entities and XInclude', () => {
    try {
      parse('<?xml version="1.0"?><Файл>&custom;</Файл>');
      expect.fail('undefined entity must be rejected');
    } catch (error) {
      expect(JSON.stringify(error)).toMatch(/entity|undefined/i);
    }
    expect(() =>
      parse(
        '<?xml version="1.0"?><Файл xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="file:///etc/passwd"/></Файл>',
      ),
    ).toThrowError(/XInclude|namespace/);
  });

  it('rejects malformed XML with a line number', () => {
    try {
      parse('<?xml version="1.0"?><Файл><Незакрыт></Файл>');
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toMatchObject({ code: 'MALFORMED_XML' });
    }
  });

  it('enforces the nesting depth limit', () => {
    const depth = config.limits.maxDepth + 2;
    const xml = `<?xml version="1.0"?>${'<a>'.repeat(depth)}${'</a>'.repeat(depth)}`;
    expect(() => parse(xml)).toThrowError(/depth/i);
  });

  it('parses the real windows-1251 sample', () => {
    const raw = readFileSync('test/fixtures/torg2.xml');
    const decoded = decodeXmlBytes(raw, config.limits.maxDecodedBytes);
    const parsed = parser.parse(decoded.text);
    expect(parsed.root.name).toBe('Файл');
    expect(parsed.root.getAttribute('ВерсФорм')).toBe('5.01');
    expect(parsed.root.child('Документ')?.getAttribute('КНД')).toBe('1175014');
  });
});
