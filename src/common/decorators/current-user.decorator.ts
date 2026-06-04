import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../guards/jwt-auth.guard';

/**
 * Injects the authenticated user (set on the request by `JwtAuthGuard`) into
 * a route handler parameter.
 *
 * ```ts
 * @UseGuards(JwtAuthGuard)
 * @Get('me')
 * me(@CurrentUser() user: JwtPayload) { ... }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    return request.user;
  },
);
