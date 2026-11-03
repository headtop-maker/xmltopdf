export interface XmlAttribute {
  readonly name: string;
  readonly value: string;
}

export class XmlNode {
  readonly name: string;
  readonly attributes: readonly XmlAttribute[];
  readonly children: XmlNode[] = [];
  readonly parent: XmlNode | null;
  readonly uid: string;
  readonly index: number;
  readonly depth: number;
  readonly line: number;
  text = '';

  private readonly attributeMap: Map<string, string>;
  private readonly childNameCounts = new Map<string, number>();

  constructor(options: {
    name: string;
    attributes: readonly XmlAttribute[];
    parent: XmlNode | null;
    uid: string;
    index: number;
    depth: number;
    line: number;
  }) {
    this.name = options.name;
    this.attributes = options.attributes;
    this.parent = options.parent;
    this.uid = options.uid;
    this.index = options.index;
    this.depth = options.depth;
    this.line = options.line;
    this.attributeMap = new Map(options.attributes.map((a) => [a.name, a.value]));
  }

  getAttribute(name: string): string | undefined {
    return this.attributeMap.get(name);
  }

  hasAttribute(name: string): boolean {
    return this.attributeMap.has(name);
  }

  child(name: string): XmlNode | undefined {
    return this.children.find((c) => c.name === name);
  }

  childrenNamed(name: string): XmlNode[] {
    return this.children.filter((c) => c.name === name);
  }

  textValue(): string {
    return this.text.trim();
  }

  nextChildUid(name: string): { uid: string; index: number } {
    const index = (this.childNameCounts.get(name) ?? 0) + 1;
    this.childNameCounts.set(name, index);
    return { uid: `${this.uid}/${name}[${index}]`, index };
  }

  walk(visitor: (node: XmlNode) => void): void {
    visitor(this);
    for (const child of this.children) child.walk(visitor);
  }
}

export interface ParsedXml {
  readonly document: XmlNode;
  readonly root: XmlNode;
  readonly elementCount: number;
  readonly maxDepth: number;
}
