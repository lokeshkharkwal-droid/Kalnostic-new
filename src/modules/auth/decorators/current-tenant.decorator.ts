import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../types/jwt-payload.type';

/**
 * Injects the active tenant id (`tenant_id`) from the authenticated user's JWT.
 *
 * ```ts
 * list(@CurrentTenant() tenantId: string) {}
 * ```
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user.tenant_id;
  },
);
