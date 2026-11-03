import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { requestContextMiddleware } from './common/request-context';
import type { AppConfig } from './config';

/**
 * Shared application wiring used by both main.ts and the integration tests:
 * raw binary body handling for /api/v1/conversions, JSON error mapping for
 * body-parser failures, global validation and Swagger.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  const server = app.getHttpAdapter().getInstance();
  server.disable('x-powered-by');

  app.use(requestContextMiddleware);

  const rawParser = express.raw({
    type: ['application/octet-stream', 'application/xml', 'text/xml'],
    limit: config.limits.maxBodyBytes,
  });
  const conversionsRawBody: express.RequestHandler = (req, res, next) => {
    if (req.method === 'POST') {
      rawParser(req, res, next);
      return;
    }
    next();
  };
  app.use('/api/v1/conversions', conversionsRawBody);
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  // Body-parser errors happen before Nest's router, so they need explicit mapping
  // to the same JSON error contract.
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      (error as { type?: string }).type === 'entity.too.large'
    ) {
      res.status(413).json({
        statusCode: 413,
        code: 'XML_LIMIT_EXCEEDED',
        message: 'The request body exceeds the configured limit',
        requestId: 'body-parser',
      });
      return;
    }
    next(error);
  });

  app.useGlobalFilters(app.get(AllExceptionsFilter));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      stopAtFirstError: false,
    }),
  );

  if (config.docsEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('XML to PDF converter')
      .setDescription(
        'Converts formalized Russian XML documents (TORG-2, UPD) into a PDF print representation ' +
          'prepared for external detached signing. The service never signs documents and never claims ' +
          'that a signature exists.',
      )
      .setVersion(config.appVersion)
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'api-key')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    });
    server.get('/openapi.json', (_req: express.Request, res: express.Response) => {
      res.json(document);
    });
  }
}
