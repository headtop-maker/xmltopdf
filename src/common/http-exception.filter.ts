import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { isAppError, type ErrorCode, type ErrorDetail } from './errors';
import { currentRequestId } from './request-context';
import { logger } from './logger';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  details?: ErrorDetail[];
  truncated?: boolean;
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'MALFORMED_XML',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'AMBIGUOUS_DOCUMENT_TYPE',
  413: 'XML_LIMIT_EXCEEDED',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'BUSINESS_VALIDATION_FAILED',
  429: 'TOO_MANY_REQUESTS',
  503: 'RENDERER_UNAVAILABLE',
  504: 'CONVERSION_TIMEOUT',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const requestId = currentRequestId();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = 'CONVERSION_FAILED';
    let message = 'The conversion failed';
    let details: ErrorDetail[] | undefined;
    let truncated: boolean | undefined;

    if (isAppError(exception)) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details ? [...exception.details] : undefined;
      truncated = exception.detailsTruncated;
      if (exception.retryAfterSeconds) response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? 'CONVERSION_FAILED';
      const payload = exception.getResponse();
      message = typeof payload === 'string' ? payload : (payload as { message?: string }).message ?? exception.message;
      if (Array.isArray((payload as { message?: unknown }).message)) {
        details = ((payload as { message: string[] }).message).map((item) => ({ message: item }));
        message = 'Request validation failed';
      }
    } else if (isPayloadTooLarge(exception)) {
      status = 413;
      code = 'XML_LIMIT_EXCEEDED';
      message = 'The request body exceeds the configured limit';
      (response as Response).status(status);
    }

    if (status >= 500) {
      logger.error('http.error', {
        status,
        code,
        path: request?.path,
        method: request?.method,
        error: exception instanceof Error ? exception.name : typeof exception,
      });
    } else {
      logger.warn('http.rejected', { status, code, path: request?.path, method: request?.method });
    }

    const body: ErrorBody = {
      statusCode: status,
      code,
      message,
      requestId,
      ...(details && details.length > 0 ? { details } : {}),
      ...(truncated !== undefined ? { truncated } : {}),
    };
    response.status(status).json(body);
  }
}

function isPayloadTooLarge(exception: unknown): boolean {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'type' in exception &&
    (exception as { type?: string }).type === 'entity.too.large'
  );
}
