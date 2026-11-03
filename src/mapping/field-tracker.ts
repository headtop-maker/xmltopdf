import type { XmlNode } from '../xml-security/xml-tree';

export type FieldStatus = 'rendered' | 'appendix' | 'technical' | 'unmapped';

export interface ConsumedField {
  readonly status: FieldStatus;
  readonly note?: string;
}

export function fieldKey(node: XmlNode, name: string): string {
  return `${node.uid}@${name}`;
}

export function textKey(node: XmlNode): string {
  return `${node.uid}#text`;
}

/**
 * Records which pieces of the source XML were accounted for while building the
 * print model. Every meaningful attribute value and text node must end up as
 * rendered, appendix or technical; anything left is reported as unmapped.
 */
export class FieldTracker {
  private readonly consumed = new Map<string, ConsumedField>();

  consumeAttr(node: XmlNode, name: string, status: FieldStatus = 'rendered', note?: string): string | undefined {
    const value = node.getAttribute(name);
    if (value === undefined) return undefined;
    this.consumed.set(fieldKey(node, name), { status, note });
    return value;
  }

  consumeText(node: XmlNode, status: FieldStatus = 'rendered', note?: string): string | undefined {
    if (node.text.trim() === '') return undefined;
    this.consumed.set(textKey(node), { status, note });
    return node.text.trim();
  }

  consumeNodeAsTechnical(node: XmlNode, note?: string): void {
    for (const attribute of node.attributes) {
      this.consumed.set(fieldKey(node, attribute.name), { status: 'technical', note });
    }
    if (node.text.trim() !== '') this.consumed.set(textKey(node), { status: 'technical', note });
  }

  get(key: string): ConsumedField | undefined {
    return this.consumed.get(key);
  }

  mark(key: string, status: FieldStatus, note?: string): void {
    this.consumed.set(key, { status, note });
  }

  size(): number {
    return this.consumed.size;
  }
}
