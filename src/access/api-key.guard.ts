import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config';
import { errors } from '../common/errors';

export interface Principal {
  readonly ownerId: string;
}

export type AuthenticatedRequest = Request & { principal?: Principal };

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const apiKey = request.header('x-api-key');
    if (!apiKey) throw errors.unauthorized();
    const record = this.config.apiKeys.get(apiKey);
    if (!record) throw errors.unauthorized();
    request.principal = { ownerId: record.ownerId };
    return true;
  }
}
