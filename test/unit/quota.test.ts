import { describe, expect, it } from 'vitest';
import { OwnerQuotaService } from '../../src/access/owner-quota.service';
import type { AppConfig } from '../../src/config';

function service(limit: number): OwnerQuotaService {
  return new OwnerQuotaService({ rateLimitPerMinute: limit } as AppConfig);
}

describe('OwnerQuotaService', () => {
  it('allows requests up to the limit and reports Retry-After after it', () => {
    const quota = service(2);
    expect(quota.consume('owner', 1_000)).toEqual({ allowed: true });
    expect(quota.consume('owner', 1_001)).toEqual({ allowed: true });
    const denied = quota.consume('owner', 2_000);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.retryAfterSeconds).toBe(59);
  });

  it('uses an independent window per owner', () => {
    const quota = service(1);
    expect(quota.consume('a', 0)).toEqual({ allowed: true });
    expect(quota.consume('b', 0)).toEqual({ allowed: true });
    expect(quota.consume('a', 1).allowed).toBe(false);
  });

  it('resets the window after a minute and can be disabled', () => {
    const quota = service(1);
    expect(quota.consume('owner', 0)).toEqual({ allowed: true });
    expect(quota.consume('owner', 59_999).allowed).toBe(false);
    expect(quota.consume('owner', 60_000)).toEqual({ allowed: true });

    const unlimited = service(0);
    for (let i = 0; i < 100; i += 1) expect(unlimited.consume('owner', i).allowed).toBe(true);
  });
});
