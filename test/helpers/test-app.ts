import { Test, type TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'superagent';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { loadConfig } from '../../src/config';

export async function createTestApp(): Promise<{
  app: NestExpressApplication;
  moduleRef: TestingModule;
  close: () => Promise<void>;
}> {
  const config = loadConfig();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app, config);
  await app.init();
  return {
    app,
    moduleRef,
    close: async () => {
      await app.close();
    },
  };
}

/** Collects a binary HTTP response into a Buffer (supertest does not by default for PDFs). */
export function binaryParser(res: Response, callback: (error: Error | null, body?: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', (error) => callback(error));
}
