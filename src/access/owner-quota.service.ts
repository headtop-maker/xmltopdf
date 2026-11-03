import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';

interface Bucket {
  windowStart: number;
  count: number;
}

/**
 * Fixed-window request quota per owner. The first version runs in one process,
 * so an in-memory map is sufficient; a multi-replica deployment must move this
 * counter to a shared store. A limit of 0 disables the quota (explicit opt-out).
 */
@Injectable()
export class OwnerQuotaService {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs = 60_000;
  private readonly limit: number;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.limit = config.rateLimitPerMinute;
  }

  consume(ownerId: string, now = Date.now()): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    if (this.limit <= 0) return { allowed: true };

    const bucket = this.buckets.get(ownerId);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(ownerId, { windowStart: now, count: 1 });
      this.evictStale(now);
      return { allowed: true };
    }
    if (bucket.count >= this.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((bucket.windowStart + this.windowMs - now) / 1000),
      );
      return { allowed: false, retryAfterSeconds };
    }
    bucket.count += 1;
    return { allowed: true };
  }

  private evictStale(now: number): void {
    if (this.buckets.size < 10_000) return;
    for (const [ownerId, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) this.buckets.delete(ownerId);
    }
  }

  static error(retryAfterSeconds: number): AppError {
    return new AppError(429, 'TOO_MANY_REQUESTS', 'The owner request quota is exhausted', {
      retryAfterSeconds,
    });
  }
}
