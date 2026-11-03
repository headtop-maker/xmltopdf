import { Inject, Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config';
import type { FieldLabelSource } from '../mapping/coverage';

@Injectable()
export class FieldLabelsService {
  private readonly cache = new Map<string, FieldLabelSource>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get(name: string): FieldLabelSource {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const file = path.join(this.config.dictionariesDir, `${name}.json`);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as FieldLabelSource;
    this.cache.set(name, parsed);
    return parsed;
  }
}
