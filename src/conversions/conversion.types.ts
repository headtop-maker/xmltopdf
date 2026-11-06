import type { ArtifactDocument, ArtifactValidation, ArtifactWarning } from '../documents/document.types';

/** Everything the HTTP layer needs to answer with a PDF and its metadata headers. */
export interface ConversionResult {
  readonly pdf: Buffer;
  readonly pdfSha256: string;
  readonly sourceSha256: string;
  readonly pageCount: number;
  readonly document: ArtifactDocument;
  readonly validation: ArtifactValidation;
  readonly warnings: readonly ArtifactWarning[];
  readonly templateVersion: string;
  /** True when the bytes came from the in-memory cache instead of a fresh render. */
  readonly cacheHit: boolean;
}
