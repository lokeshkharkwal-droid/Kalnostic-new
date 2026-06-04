import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { UnauthorisedException } from '../../../common/exceptions/kaltros.exception';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Primary business authentication guard. Registered globally in `AppModule`, so
 * every endpoint is protected by default; use `@Public()` to opt out
 * (CLAUDE.md §5.1). Validates the Bearer token via `JwtStrategy`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * Allow public routes through; otherwise delegate to Passport validation.
   */
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  /**
   * Return our typed exception instead of Passport's default 401, while letting
   * already-typed exceptions (e.g. account locked) pass through.
   */
  handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      if (err && typeof err === 'object' && 'errorCode' in err) {
        throw err;
      }
      throw new UnauthorisedException(
        'Invalid or expired token. Please log in again.',
      );
    }
    return user;
  }
}
