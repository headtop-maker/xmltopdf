import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { logger } from './common/logger';
import { loadConfig } from './config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: false,
  });
  configureApp(app, config);
  app.enableShutdownHooks();

  const shutdown = (signal: string): void => {
    logger.info('process.shutdown', { signal });
    void app.close().then(() => process.exit(0));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  await app.listen(config.port, '0.0.0.0');
  logger.info('service.started', {
    port: config.port,
    env: config.env,
    publicBaseUrl: config.publicBaseUrl,
    docs: config.docsEnabled,
    version: config.appVersion,
  });
}

bootstrap().catch((error: unknown) => {
  logger.error('service.start.failed', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
