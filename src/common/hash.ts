import { createHash } from 'node:crypto';

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function shortHash(hash: string, length = 12): string {
  return hash.slice(0, Math.max(8, Math.min(length, 64)));
}
