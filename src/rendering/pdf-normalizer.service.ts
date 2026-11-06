import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { AppError } from '../common/errors';

/**
 * Removes render-time metadata so the same XML always produces the same bytes.
 *
 * Chromium stamps CreationDate/ModDate and a document id, so two renders of the
 * same input differ. A fixed timestamp and producer make `pdfSha256` stable,
 * which keeps file names stable and lets a client verify a re-render.
 */
@Injectable()
export class PdfNormalizerService {
  private static readonly FIXED_DATE = new Date(0);

  async normalize(pdf: Buffer): Promise<Buffer> {
    try {
      const document = await PDFDocument.load(pdf, { updateMetadata: false });
      document.setCreationDate(PdfNormalizerService.FIXED_DATE);
      document.setModificationDate(PdfNormalizerService.FIXED_DATE);
      document.setProducer('xmltopdf');
      document.setCreator('xmltopdf');
      return Buffer.from(await document.save({ useObjectStreams: false }));
    } catch (cause) {
      throw new AppError(500, 'CONVERSION_FAILED', 'The rendered PDF could not be normalized', { cause });
    }
  }
}
