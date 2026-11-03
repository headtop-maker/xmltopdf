import { currentRequestId } from './request-context';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

/**
 * Minimal structured JSON logger. Callers must never pass document content,
 * personal data, API keys, download tokens or full URLs: only identifiers,
 * versions, sizes and durations belong in logs.
 */
export class AppLogger {
  constructor(
    private readonly service: string,
    private readonly minLevel: LogLevel = 'info',
  ) {}

  debug(event: string, fields: LogFields = {}): void {
    this.write('debug', event, fields);
  }

  info(event: string, fields: LogFields = {}): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.write('error', event, fields);
  }

  child(component: string): AppLogger {
    return new AppLogger(`${this.service}.${component}`, this.minLevel);
  }

  private write(level: LogLevel, event: string, fields: LogFields): void {
    if (LEVELS[level] < LEVELS[this.minLevel]) return;
    const record = {
      ts: new Date().toISOString(),
      level,
      service: this.service,
      event,
      requestId: currentRequestId(),
      ...fields,
    };
    const line = JSON.stringify(record);
    if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }
}

export const logger = new AppLogger('xmltopdf', (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info');
