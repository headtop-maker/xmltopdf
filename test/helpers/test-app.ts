import { Test, type TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { rm } from 'node:fs/promises';
import * as path from 'node:path';
import type { Response } from 'superagent';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { loadConfig } from '../../src/config';
import { ArtifactsService } from '../../src/artifacts/artifacts.service';

export async function createTestApp(options: { clean?: boolean } = {}): Promise<{
  app: NestExpressApplication;
  moduleRef: TestingModule;
  close: (options?: { clean?: boolean }) => Promise<void>;
}> {
  const config = loadConfig();
  if (options.clean !== false) {
    await rm(path.resolve(config.dataDir), { recursive: true, force: true });
  }

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
    close: async (closeOptions: { clean?: boolean } = {}) => {
      await app.close();
      if (closeOptions.clean !== false) {
        await rm(path.resolve(config.dataDir), { recursive: true, force: true });
      }
    },
  };
}

/** Collects a binary HTTP response into a Buffer (supertest does not by default for PDFs). */
export function binaryParser(res: Response, callback: (error: Error | null, body?: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', (error: Error) => callback(error));
}

export async function clearArtifacts(moduleRef: TestingModule): Promise<void> {
  await moduleRef.get(ArtifactsService).clearAll();
}
