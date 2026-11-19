import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — tenant not found by id/slug. */
export class TenantNotFoundException extends KaltrosException {
  constructor(idOrSlug: string) {
    super(
      'TENANT_NOT_FOUND',
      'Tenant not found',
      { idOrSlug },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — slug already in use (slugs are permanent subdomains). */
export class TenantSlugTakenException extends KaltrosException {
  constructor(slug: string) {
    super(
      'TENANT_SLUG_TAKEN',
      'This subdomain slug is already taken',
      { slug },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — custom domain already claimed by another tenant. */
export class TenantCustomDomainTakenException extends KaltrosException {
  constructor(customDomain: string) {
    super(
      'TENANT_CUSTOM_DOMAIN_TAKEN',
      'This custom domain is already in use',
      { customDomain },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 409 - the tenant row is locked by another request (an order being created, another admin saving the
 * grouping mode) for longer than the wait limit. Nothing was changed; the admin can simply save again.
 */
export class TenantGroupingModeBusyException extends KaltrosException {
  constructor(tenantId: string) {
    super(
      'TENANT_GROUPING_MODE_BUSY',
      'The grouping mode could not be saved right now because the system is busy. Nothing was changed. Please try again in a moment.',
      { tenantId },
      HttpStatus.CONFLICT,
    );
  }
}
