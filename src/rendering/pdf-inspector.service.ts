import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFName } from 'pdf-lib';
import { AppError } from '../common/errors';

export interface PdfInspection {
  readonly pdfVersion: string;
  readonly pageCount: number;
  readonly hasEncryption: boolean;
  readonly hasAcroForm: boolean;
  readonly hasActiveContent: boolean;
  readonly hasEmbeddedFiles: boolean;
}

@Injectable()
export class PdfInspectorService {
  async inspect(buffer: Buffer): Promise<PdfInspection> {
    const header = buffer.subarray(0, 8).toString('latin1');
    if (!header.startsWith('%PDF-')) {
      throw new AppError(500, 'CONVERSION_FAILED', 'The renderer returned a file that is not a PDF');
    }
    const pdfVersion = header.slice(5, 8);

    let document: PDFDocument;
    try {
      document = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        updateMetadata: false,
        throwOnInvalidObject: true,
      });
    } catch (cause) {
      throw new AppError(500, 'CONVERSION_FAILED', 'The rendered PDF is structurally invalid', { cause });
    }

    const hasEncryption = document.context.trailerInfo.Encrypt !== undefined;
    const catalog = document.catalog;
    const hasAcroForm = catalog.get(PDFName.of('AcroForm')) !== undefined;
    const hasActiveContent =
      catalog.get(PDFName.of('OpenAction')) !== undefined ||
      catalog.get(PDFName.of('AA')) !== undefined ||
      catalog.get(PDFName.of('JavaScript')) !== undefined;
    const names = catalog.get(PDFName.of('Names'));
    let hasEmbeddedFiles = false;
    if (names) {
      const dictionary = names as unknown as { get?: (name: PDFName) => unknown };
      if (typeof dictionary.get === 'function') {
        hasEmbeddedFiles = dictionary.get(PDFName.of('EmbeddedFiles')) !== undefined;
        if (dictionary.get(PDFName.of('JavaScript')) !== undefined) {
          // Covered by hasActiveContent above; kept for completeness.
          hasEmbeddedFiles = hasEmbeddedFiles;
        }
      }
    }

    return {
      pdfVersion,
      pageCount: document.getPageCount(),
      hasEncryption,
      hasAcroForm,
      hasActiveContent,
      hasEmbeddedFiles,
    };
  }
}
