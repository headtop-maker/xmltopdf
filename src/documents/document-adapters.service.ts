import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import type { SchemaDescriptor } from '../document-registry/document-registry.service';
import type { PrintAdapter } from './adapter';
import { Torg2Adapter } from './torg2/torg2.adapter';
import { UpdAdapter } from './upd/upd.adapter';
import { UpdTitle1Adapter } from './upd/upd-title1.adapter';
import { Torg2Title1Adapter } from './torg2/torg2-title1.adapter';

@Injectable()
export class DocumentAdaptersService {
  private readonly adapters = new Map<string, PrintAdapter>();

  constructor(
    torg2: Torg2Adapter,
    torg2Title1: Torg2Title1Adapter,
    upd: UpdAdapter,
    updTitle1: UpdTitle1Adapter,
  ) {
    for (const adapter of [torg2, torg2Title1, upd, updTitle1]) {
      this.adapters.set(adapter.descriptor.id, adapter as PrintAdapter);
    }
  }

  get(descriptor: SchemaDescriptor): PrintAdapter {
    const adapter = this.adapters.get(descriptor.id);
    if (!adapter) {
      throw new AppError(422, 'UNSUPPORTED_TITLE', 'No print adapter is implemented for this title', {
        details: [{ message: descriptor.titleLabel }],
      });
    }
    return adapter;
  }

  all(): PrintAdapter[] {
    return [...this.adapters.values()];
  }
}
