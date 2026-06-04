import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest, JwtPayload } from '../types/jwt-payload.type';

/**
 * Injects the authenticated business user (the JWT payload) into a handler
 * parameter, or a single field of it when a key is passed.
 *
 * ```ts
 * me(@CurrentUser() user: JwtPayload) {}
 * me(@CurrentUser('person_id') personId: string) {}
 * ```
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
