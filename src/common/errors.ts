export type ErrorCode =
  | 'EMPTY_BODY'
  | 'MALFORMED_XML'
  | 'INVALID_ENCODING'
  | 'UNSAFE_XML'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'AMBIGUOUS_DOCUMENT_TYPE'
  | 'DOCUMENT_TYPE_MISMATCH'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'XML_LIMIT_EXCEEDED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNSUPPORTED_DOCUMENT'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_TITLE'
  | 'UNSUPPORTED_FUNCTION'
  | 'XSD_VALIDATION_FAILED'
  | 'BUSINESS_VALIDATION_FAILED'
  | 'UNMAPPED_DATA'
  | 'PDF_PAGE_LIMIT_EXCEEDED'
  | 'UNRENDERABLE_CONTENT'
  | 'TOO_MANY_REQUESTS'
  | 'RENDERER_BUSY'
  | 'STORAGE_UNAVAILABLE'
  | 'RENDERER_UNAVAILABLE'
  | 'RENDERER_TIMEOUT'
  | 'CONVERSION_TIMEOUT'
  | 'CONVERSION_FAILED'
  | 'NOT_FOUND'
  | 'ARTIFACT_EXPIRED'
  | 'VALIDATION_UNAVAILABLE'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export interface ErrorDetail {
  readonly path?: string;
  readonly line?: number;
  readonly message: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: readonly ErrorDetail[];
  readonly detailsTruncated?: boolean;
  readonly retryAfterSeconds?: number;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    options: {
      details?: readonly ErrorDetail[];
      detailsTruncated?: boolean;
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.detailsTruncated = options.detailsTruncated;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export const errors = {
  emptyBody: () => new AppError(400, 'EMPTY_BODY', 'Request body is empty'),
  malformedXml: (message: string, line?: number) =>
    new AppError(400, 'MALFORMED_XML', 'The XML document is not well-formed', {
      details: [{ message, line }],
    }),
  invalidEncoding: (message: string) =>
    new AppError(400, 'INVALID_ENCODING', message),
  unsafeXml: (message: string) =>
    new AppError(400, 'UNSAFE_XML', message),
  unauthorized: () => new AppError(401, 'UNAUTHORIZED', 'A valid API key is required'),
  forbidden: (message = 'Access to this resource is not allowed') =>
    new AppError(403, 'FORBIDDEN', message),
  notFound: (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message),
  conflict: (code: ErrorCode, message: string, details?: ErrorDetail[]) =>
    new AppError(409, code, message, { details }),
  unsupportedMedia: () =>
    new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only XML documents are accepted as the request body'),
  limit: (message: string, details?: ErrorDetail[]) =>
    new AppError(413, 'XML_LIMIT_EXCEEDED', message, { details }),
  unsupported: (code: ErrorCode, message: string, details?: ErrorDetail[]) =>
    new AppError(422, code, message, { details }),
  unmapped: (message: string, details: ErrorDetail[]) =>
    new AppError(422, 'UNMAPPED_DATA', message, { details, detailsTruncated: details.length > 50 }),
  rendererBusy: (retryAfterSeconds: number) =>
    new AppError(503, 'RENDERER_BUSY', 'The PDF renderer is at capacity; retry later', {
      retryAfterSeconds,
    }),
  timeout: () =>
    new AppError(504, 'CONVERSION_TIMEOUT', 'The conversion deadline was exceeded'),
  storage: (message = 'Artifact storage is unavailable') =>
    new AppError(503, 'STORAGE_UNAVAILABLE', message),
};
