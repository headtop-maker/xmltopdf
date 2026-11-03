import { Inject, Injectable } from '@nestjs/common';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { APP_CONFIG, type AppConfig } from '../config';
import { AppError, errors } from '../common/errors';
import { XmlNode, type ParsedXml } from './xml-tree';

const XINCLUDE_NS = 'http://www.w3.org/2001/XInclude';

/**
 * Strict namespace-aware parse of already-decoded XML.
 *
 * The parser is non-validating and never resolves external resources. DTDs,
 * entity declarations, processing instructions and XInclude are rejected
 * before the tree is used; only built-in and numeric character references are
 * allowed by saxes.
 */
@Injectable()
export class XmlParserService {
  private readonly limits;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.limits = config.limits;
  }

  parse(text: string): ParsedXml {
    const parser = new SaxesParser({ xmlns: true });
    const documentNode = new XmlNode({
      name: '#document',
      attributes: [],
      parent: null,
      uid: '',
      index: 0,
      depth: 0,
      line: 1,
    });

    let current: XmlNode = documentNode;
    let elementCount = 0;
    let maxDepth = 0;

    const unsafe = (message: string, line?: number): never => {
      throw new AppError(400, 'UNSAFE_XML', message, {
        details: line === undefined ? undefined : [{ line, message }],
      });
    };

    parser.on('error', (error: Error & { line?: number }) => {
      throw errors.malformedXml(error.message, typeof error.line === 'number' ? error.line : undefined);
    });

    parser.on('doctype', () => {
      unsafe('DTD and document type declarations are not allowed', parser.line + 1);
    });

    parser.on('processinginstruction', (instruction) => {
      unsafe(
        `Processing instruction "${instruction.target}" is not allowed`,
        parser.line + 1,
      );
    });

    parser.on('opentag', (tag: SaxesTagNS) => {
      elementCount += 1;
      if (elementCount > this.limits.maxElements) {
        throw errors.limit(
          `The document exceeds the element limit (${this.limits.maxElements})`,
          [{ message: `More than ${this.limits.maxElements} elements` }],
        );
      }
      if (tag.uri === XINCLUDE_NS && tag.local === 'include') {
        unsafe('XInclude is not allowed', parser.line + 1);
      }
      if (tag.uri !== '') {
        throw errors.malformedXml(
          `Unexpected namespace "${tag.uri}" on element "${tag.name}"; this document format does not use namespaces`,
          parser.line + 1,
        );
      }

      const depth = current.depth + 1;
      if (depth > this.limits.maxDepth) {
        throw errors.limit(`The document exceeds the nesting depth limit (${this.limits.maxDepth})`, [
          { message: `Nesting depth exceeds ${this.limits.maxDepth}` },
        ]);
      }
      maxDepth = Math.max(maxDepth, depth);

      const { uid, index } = current.nextChildUid(tag.name);
      const attributes = Object.keys(tag.attributes).map((name) => ({
        name,
        value: tag.attributes[name].value,
      }));
      const node = new XmlNode({
        name: tag.name,
        attributes,
        parent: current,
        uid,
        index,
        depth,
        line: parser.line + 1,
      });
      current.children.push(node);
      current = node;
    });

    parser.on('text', (value) => {
      this.appendText(current, value);
    });

    parser.on('cdata', (value) => {
      this.appendText(current, value);
    });

    parser.on('closetag', () => {
      current = current.parent ?? documentNode;
    });

    try {
      parser.write(text).close();
    } catch (error) {
      if (error instanceof AppError) throw error;
      const line =
        error && typeof error === 'object' && 'line' in error
          ? Number((error as { line?: unknown }).line)
          : undefined;
      const message = error instanceof Error ? error.message : 'XML parsing failed';
      throw errors.malformedXml(message, Number.isFinite(line) ? line : undefined);
    }

    const roots = documentNode.children;
    if (roots.length !== 1) {
      throw errors.malformedXml('The document must have exactly one root element');
    }

    return {
      document: documentNode,
      root: roots[0],
      elementCount,
      maxDepth,
    };
  }

  private appendText(node: XmlNode, value: string): void {
    node.text += value;
    if (node.text.length > this.limits.maxValueChars) {
      throw errors.limit(
        `A single value exceeds ${this.limits.maxValueChars} characters`,
        [{ line: node.line, message: 'Text value too long' }],
      );
    }
  }
}
