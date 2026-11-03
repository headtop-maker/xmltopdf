import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import type { ParsedXml } from '../xml-security/xml-tree';

export type DocumentFamily = 'Torg2' | 'UniversalTransferDocument' | 'Invoice';
export const DOCUMENT_TYPE_HINTS = ['Torg2', 'UniversalTransferDocument', 'Invoice'] as const;
export type DocumentTypeHint = (typeof DOCUMENT_TYPE_HINTS)[number];

export interface SchemaDescriptor {
  readonly id: string;
  readonly family: DocumentFamily;
  readonly formatVersion: string;
  readonly operatorVersion: string;
  readonly titleIndex: number;
  readonly knd: string;
  readonly schemaRevision: string;
  readonly schemaFile: string;
  readonly schemaSha256: string;
  readonly sourceUrl: string;
  readonly titleLabel: string;
  readonly implemented: boolean;
  readonly templateVersion: string | null;
  readonly functions: readonly string[];
  readonly supportedFunctions: readonly string[];
}

interface ManifestSchema {
  readonly id: string;
  readonly family: DocumentFamily;
  readonly formatVersion: string;
  readonly operatorVersion: string;
  readonly titleIndex: number;
  readonly knd: string;
  readonly schemaRevision: string;
  readonly file: string;
  readonly sha256: string;
  readonly sourceUrl: string;
  readonly titleLabel: string;
  readonly implemented: boolean;
  readonly templateVersion: string | null;
  readonly functions: readonly string[];
  readonly supportedFunctions: readonly string[];
}

export interface XmlMetadata {
  readonly rootName: string;
  readonly formatVersion?: string;
  readonly programVersion?: string;
  readonly sourceId?: string;
  readonly knd?: string;
  readonly documentName?: string;
  readonly documentNumber?: string;
  readonly documentDate?: string;
  /** UPD only: СЧФ, СЧФДОП, ДОП, СвРК or СвЗК. TORG-2 has no such attribute. */
  readonly documentFunction?: string;
  readonly documentUid?: string;
}

export function extractMetadata(parsed: ParsedXml): XmlMetadata {
  const root = parsed.root;
  const document = root.child('Документ');
  const identity = document?.child('ИдентДокПР');
  return {
    rootName: root.name,
    formatVersion: root.getAttribute('ВерсФорм'),
    programVersion: root.getAttribute('ВерсПрог'),
    sourceId: root.getAttribute('ИдФайл'),
    knd: document?.getAttribute('КНД'),
    documentName: document?.getAttribute('НаимДокОпр'),
    documentNumber: identity?.getAttribute('НомДокПР'),
    documentDate: identity?.getAttribute('ДатаДокПР'),
    documentFunction:
      document?.getAttribute('Функция') ?? document?.child('СодФХЖ4')?.getAttribute('Функция'),
    documentUid: document?.getAttribute('УИД'),
  };
}

const ID_PREFIX_HINTS: Record<string, readonly string[]> = {
  torg2_05_01_01_title0: ['DP_PRIRASXPRINMARK_', 'DP_PRIRASXPRIN_'],
  torg2_05_01_01_title1: ['DP_PRIRASXDOP_'],
  utd970_05_03_01_title0: ['ON_NSCHFDOPPR_'],
  utd970_05_03_01_title1: ['ON_NSCHFDOPPOK_'],
};

@Injectable()
export class DocumentRegistry {
  private descriptors: SchemaDescriptor[] = [];
  private readonly byId = new Map<string, SchemaDescriptor>();
  private readonly verifiedSchemas = new Set<string>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.load();
  }

  load(): void {
    const manifestPath = path.join(this.config.manifestsDir, 'schemas.json');
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      schemas: ManifestSchema[];
    };
    const descriptors: SchemaDescriptor[] = [];
    for (const entry of raw.schemas) {
      const schemaPath = path.join(this.config.schemasDir, entry.file);
      if (!statSync(schemaPath).isFile()) {
        throw new Error(`Schema file is missing: ${entry.file}`);
      }
      const digest = createHash('sha256').update(readFileSync(schemaPath)).digest('hex');
      if (digest !== entry.sha256) {
        throw new Error(
          `Schema ${entry.id} does not match the pinned checksum: expected ${entry.sha256}, got ${digest}`,
        );
      }
      this.verifiedSchemas.add(schemaPath);
      descriptors.push({
        ...entry,
        schemaFile: entry.file,
        schemaSha256: entry.sha256,
      });
    }
    this.descriptors = descriptors;
    this.byId.clear();
    for (const descriptor of descriptors) this.byId.set(descriptor.id, descriptor);
  }

  all(): readonly SchemaDescriptor[] {
    return this.descriptors;
  }

  implemented(): readonly SchemaDescriptor[] {
    return this.descriptors.filter((d) => d.implemented);
  }

  get(id: string): SchemaDescriptor {
    const found = this.byId.get(id);
    if (!found) throw new AppError(500, 'CONVERSION_FAILED', `Unknown adapter id: ${id}`);
    return found;
  }

  schemaPath(descriptor: SchemaDescriptor): string {
    return path.join(this.config.schemasDir, descriptor.schemaFile);
  }

  isSchemaVerified(descriptor: SchemaDescriptor): boolean {
    return this.verifiedSchemas.has(this.schemaPath(descriptor));
  }

  detect(metadata: XmlMetadata): SchemaDescriptor {
    if (metadata.rootName !== 'Файл') {
      throw new AppError(422, 'UNSUPPORTED_DOCUMENT', 'The XML root element is not supported', {
        details: [{ path: `/${metadata.rootName}`, message: 'Expected root element "Файл"' }],
      });
    }
    if (!metadata.formatVersion) {
      throw new AppError(422, 'UNSUPPORTED_VERSION', 'The Файл/@ВерсФорм attribute is missing');
    }

    const versionKnown = this.descriptors.some(
      (d) => d.formatVersion === metadata.formatVersion,
    );
    if (!versionKnown) {
      throw new AppError(422, 'UNSUPPORTED_VERSION', 'This XML format version is not supported', {
        details: [
          {
            path: '/Файл/@ВерсФорм',
            message: `Version "${metadata.formatVersion}" is not in the supported matrix`,
          },
        ],
      });
    }

    const byKnd = this.descriptors.filter(
      (d) => d.formatVersion === metadata.formatVersion && d.knd === metadata.knd,
    );
    if (byKnd.length === 0) {
      const supportedKnds = this.descriptors
        .filter((d) => d.formatVersion === metadata.formatVersion)
        .map((d) => d.knd);
      throw new AppError(422, 'UNSUPPORTED_TITLE', 'The document title is not supported', {
        details: [
          {
            path: '/Файл/Документ/@КНД',
            message: `КНД "${metadata.knd ?? '(missing)'}" is not supported for version ${metadata.formatVersion}; supported: ${supportedKnds.join(', ')}`,
          },
        ],
      });
    }
    if (byKnd.length > 1) {
      throw new AppError(409, 'AMBIGUOUS_DOCUMENT_TYPE', 'The document matches several titles', {
        details: byKnd.map((d) => ({ message: `${d.family} ${d.schemaRevision}` })),
      });
    }

    const descriptor = byKnd[0];
    if (!descriptor.implemented) {
      throw new AppError(
        422,
        'UNSUPPORTED_TITLE',
        'This document title is recognized but not yet supported for printing',
        {
          details: [
            {
              message: `${descriptor.titleLabel} (${descriptor.schemaRevision}) is not implemented`,
            },
          ],
        },
      );
    }
    if (descriptor.family === 'UniversalTransferDocument') {
      const fn = metadata.documentFunction;
      if (!fn) {
        throw new AppError(422, 'UNSUPPORTED_FUNCTION', 'The Документ/@Функция attribute is missing', {
          details: [
            {
              path: '/Файл/Документ/@Функция',
              message: 'UPD printing depends on the document function (СЧФ, ДОП, СЧФДОП, СвРК, СвЗК)',
            },
          ],
        });
      }
      if (!descriptor.functions.includes(fn)) {
        throw new AppError(422, 'UNSUPPORTED_FUNCTION', 'This UPD function is not supported by the pinned schema', {
          details: [
            {
              path: '/Файл/Документ/@Функция',
              message: `Function "${fn}" is not in {${descriptor.functions.join(', ')}}`,
            },
          ],
        });
      }
      if (!descriptor.supportedFunctions.includes(fn)) {
        throw new AppError(
          422,
          'UNSUPPORTED_FUNCTION',
          'This UPD function is recognized but its print form is not implemented',
          {
            details: [
              {
                message: `Function "${fn}" is not printable for ${descriptor.titleLabel}`,
              },
            ],
          },
        );
      }
    }
    return descriptor;
  }

  assertHintCompatible(
    descriptor: SchemaDescriptor,
    hint: DocumentTypeHint | undefined,
    metadata: XmlMetadata,
  ): void {
    if (!hint) return;
    let compatible: boolean;
    switch (hint) {
      case 'Torg2':
        compatible = descriptor.family === 'Torg2';
        break;
      case 'UniversalTransferDocument':
        compatible = descriptor.family === 'UniversalTransferDocument';
        break;
      case 'Invoice':
        compatible =
          descriptor.family === 'UniversalTransferDocument' &&
          descriptor.titleIndex === 0 &&
          metadata.documentFunction === 'СЧФ';
        break;
      default:
        compatible = false;
    }
    if (!compatible) {
      throw new AppError(422, 'DOCUMENT_TYPE_MISMATCH', 'documentType does not match the XML document', {
        details: [
          {
            message: `Requested "${hint}", detected ${descriptor.family} (${descriptor.schemaRevision})`,
          },
        ],
      });
    }
  }

  prefixHint(descriptor: SchemaDescriptor, sourceId: string | undefined): boolean {
    if (!sourceId) return false;
    const prefixes = ID_PREFIX_HINTS[descriptor.id] ?? [];
    return prefixes.some((prefix) => sourceId.startsWith(prefix));
  }
}
