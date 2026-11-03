import { XmlNode } from '../xml-security/xml-tree';
import { fieldKey, textKey, type FieldStatus, type FieldTracker } from './field-tracker';

export interface FieldLabelSource {
  readonly elementDocs: Record<string, string>;
  readonly attributeDocs: Record<string, string>;
}

export interface CoverageItem {
  readonly key: string;
  readonly nodeUid: string;
  readonly kind: 'attr' | 'text';
  readonly name: string;
  readonly label: string;
  readonly path: string;
  readonly section: string;
  readonly value: string;
  readonly status: FieldStatus;
  readonly note?: string;
}

const SKIPPED_ANCESTORS = new Set(['#document', 'Файл']);

function pathOf(node: XmlNode, _labels: FieldLabelSource): string {
  const parts: string[] = [];
  let current: XmlNode | null = node;
  while (current && !SKIPPED_ANCESTORS.has(current.name)) {
    parts.unshift(current.name);
    current = current.parent;
  }
  return parts.join(' → ');
}

function sectionOf(node: XmlNode, labels: FieldLabelSource): string {
  let current: XmlNode | null = node;
  while (current && current.parent && !SKIPPED_ANCESTORS.has(current.parent.name)) {
    current = current.parent;
  }
  const name = current && current.name !== '#document' ? current.name : node.name;
  const label = labels.elementDocs[name];
  return label && label.length <= 60 ? label : name;
}

/**
 * Walks the parsed document and returns one coverage item per meaningful value.
 * Empty strings and whitespace-only text are not content and are not counted.
 */
export function collectCoverage(
  root: XmlNode,
  tracker: FieldTracker,
  labels: FieldLabelSource,
): CoverageItem[] {
  const items: CoverageItem[] = [];

  root.walk((node) => {
    for (const attribute of node.attributes) {
      const value = attribute.value.trim();
      if (value === '') continue;
      const key = fieldKey(node, attribute.name);
      const consumed = tracker.get(key);
      items.push({
        key,
        nodeUid: node.uid,
        kind: 'attr',
        name: attribute.name,
        label: labels.attributeDocs[attribute.name] ?? attribute.name,
        path: pathOf(node, labels),
        section: sectionOf(node, labels),
        value,
        status: consumed?.status ?? 'unmapped',
        note: consumed?.note,
      });
    }
    if (node.text.trim() !== '') {
      const key = textKey(node);
      const consumed = tracker.get(key);
      items.push({
        key,
        nodeUid: node.uid,
        kind: 'text',
        name: node.name,
        label: labels.elementDocs[node.name] ?? node.name,
        path: pathOf(node, labels),
        section: sectionOf(node, labels),
        value: node.text.trim(),
        status: consumed?.status ?? 'unmapped',
        note: consumed?.note,
      });
    }
  });

  return items;
}

export interface CoverageSummary {
  readonly items: readonly CoverageItem[];
  readonly rendered: number;
  readonly appendix: number;
  readonly technical: number;
  readonly unmapped: number;
}

export function summarizeCoverage(items: readonly CoverageItem[]): CoverageSummary {
  let rendered = 0;
  let appendix = 0;
  let technical = 0;
  let unmapped = 0;
  for (const item of items) {
    if (item.status === 'rendered') rendered += 1;
    else if (item.status === 'appendix') appendix += 1;
    else if (item.status === 'technical') technical += 1;
    else unmapped += 1;
  }
  return { items, rendered, appendix, technical, unmapped };
}
