import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, Principal } from './api-key.guard';

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.principal) throw new Error('Principal is missing: route is not guarded');
  return request.principal;
});
