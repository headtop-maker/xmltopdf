import type { XmlNode } from '../../xml-security/xml-tree';
import type { FieldStatus, FieldTracker } from '../../mapping/field-tracker';

/**
 * Read access to the parsed tree that records consumption of every value it
 * returns. Mappers must only read source data through this accessor, otherwise
 * coverage accounting becomes unreliable.
 */
export class XmlAccessor {
  constructor(private readonly tracker: FieldTracker) {}

  attr(node: XmlNode | undefined, name: string, status: FieldStatus = 'rendered', note?: string): string | undefined {
    if (!node) return undefined;
    return this.tracker.consumeAttr(node, name, status, note);
  }

  text(node: XmlNode | undefined, status: FieldStatus = 'rendered', note?: string): string | undefined {
    if (!node) return undefined;
    return this.tracker.consumeText(node, status, note);
  }

  /** Marks every attribute and the text of a node, for values carried into an appendix. */
  technical(node: XmlNode | undefined, note: string): void {
    if (!node) return;
    this.tracker.consumeNodeAsTechnical(node, note);
  }
}
