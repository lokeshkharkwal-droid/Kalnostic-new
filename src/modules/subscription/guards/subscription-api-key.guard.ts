import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { SubscriptionApiUnauthorizedException } from '../exceptions/subscription.exceptions';

/**
 * Authenticates inbound usage-report calls from the external subscription
 * scheduler. The scheduler presents the shared `key` / `secret` headers (the same
 * symmetric credentials the outbound {@link SubscriptionClient} signs with); this
 * guard checks them against `subscription.key` / `subscription.secret`.
 *
 * **Fail-closed:** if the credentials are not configured on this instance the
 * guard rejects — closing the hole the legacy EzHealthTrack endpoint left open
 * (its `accessRules1()` never ran, so the report endpoint was effectively public).
 * The comparison is constant-time to avoid leaking the secret via timing.
 */
@Injectable()
export class SubscriptionApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  /**
   * Allow the request only when both shared credentials match the configured
   * values.
   * @throws SubscriptionApiUnauthorizedException when unconfigured or mismatched
   */
  canActivate(context: ExecutionContext): boolean {
    const expectedKey = this.config.get<string>('subscription.key') ?? '';
    const expectedSecret = this.config.get<string>('subscription.secret') ?? '';
    if (!expectedKey || !expectedSecret) {
      throw new SubscriptionApiUnauthorizedException('not_configured');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const key = this.header(req, 'key');
    const secret = this.header(req, 'secret');

    if (
      !this.safeEqual(key, expectedKey) ||
      !this.safeEqual(secret, expectedSecret)
    ) {
      throw new SubscriptionApiUnauthorizedException('invalid_credentials');
    }
    return true;
  }

  /** Read a single request header as a string (ignoring array/undefined forms). */
  private header(req: Request, name: string): string {
    const raw = req.headers[name];
    return typeof raw === 'string' ? raw : '';
  }

  /** Constant-time string equality that never throws on length mismatch. */
  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
