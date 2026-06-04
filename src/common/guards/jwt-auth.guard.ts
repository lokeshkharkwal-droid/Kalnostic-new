import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

/** The decoded JWT payload we attach to the request. */
export interface JwtPayload {
  sub: string;
  email?: string;
  [key: string]: unknown;
}

/**
 * Route guard that allows a request only if it carries a valid
 * `Authorization: Bearer <token>` header (SKILL.md §8).
 *
 * On success it attaches the decoded payload to `req.user`, which the
 * `@CurrentUser()` decorator then reads.
 *
 * Requires `JwtModule` and `ConfigModule` to be available where it is used so
 * DI can supply `JwtService` and `ConfigService`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * @param context the current execution context (HTTP request)
   * @returns true if the token is valid
   * @throws UnauthorizedException when the token is missing or invalid
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      // Make the user available to handlers via @CurrentUser().
      (request as Request & { user: JwtPayload }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /** Extract the raw token from the Authorization header. */
  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
