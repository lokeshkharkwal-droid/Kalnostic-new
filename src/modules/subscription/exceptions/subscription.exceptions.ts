import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * 503 — the subscription integration is not configured (no `SUBSCRIPTION_API_URL`
 * / key / secret). Surfaced to the business so the page shows a clear message
 * instead of a broken "Register" action.
 */
export class SubscriptionNotConfiguredException extends KaltrosException {
  constructor() {
    super(
      'SUBSCRIPTION_NOT_CONFIGURED',
      'The subscription service is not configured for this environment.',
      {},
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/**
 * 409 — the tenant cannot be identified to the subscription server because it has
 * no integer business id (`legacyTenantId` / `exchangeTenantId`) to key the
 * subscription client by.
 */
export class SubscriptionBusinessIdMissingException extends KaltrosException {
  constructor(tenantId: string) {
    super(
      'SUBSCRIPTION_BUSINESS_ID_MISSING',
      'This business has no subscription id yet — it cannot be registered on the subscription server.',
      { tenantId },
      HttpStatus.CONFLICT,
    );
  }
}

/** 502 — the subscription server rejected or did not accept the registration. */
export class SubscriptionRegistrationFailedException extends KaltrosException {
  constructor(tenantId: string, context: Record<string, unknown> = {}) {
    super(
      'SUBSCRIPTION_REGISTRATION_FAILED',
      'Unable to register the business on the subscription server.',
      { tenantId, ...context },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/** 502 — the subscription server rejected a plan change (`POST /orders`). */
export class SubscriptionPlanChangeFailedException extends KaltrosException {
  constructor(tenantId: string, context: Record<string, unknown> = {}) {
    super(
      'SUBSCRIPTION_PLAN_CHANGE_FAILED',
      'Unable to change the subscription plan on the subscription server.',
      { tenantId, ...context },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/**
 * 401 — an inbound usage-report call (from the subscription scheduler) failed the
 * shared `key`/`secret` check, or the credentials are not configured on this
 * instance (fail-closed — unlike the legacy EzHealthTrack endpoint, which was
 * effectively open). `reason` distinguishes the two without leaking it to the
 * caller.
 */
export class SubscriptionApiUnauthorizedException extends KaltrosException {
  constructor(reason: 'not_configured' | 'invalid_credentials') {
    super(
      'SUBSCRIPTION_API_UNAUTHORIZED',
      'Invalid subscription API credentials.',
      { reason },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
