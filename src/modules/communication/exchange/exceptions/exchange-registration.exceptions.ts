import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../../common/exceptions/kaltros.exception';

/**
 * 409 — a tenant cannot be registered with the Exchange because it has no
 * `exchangeTenantId` yet (the integer sent as `peer_tenant_id`). Assign one via
 * `POST /siteadmin/tenants/sync-exchange-ids` first.
 */
export class ExchangeTenantIdMissingException extends KaltrosException {
  constructor(tenantId: string) {
    super(
      'EXCHANGE_TENANT_ID_MISSING',
      'Tenant has no exchange id yet — run sync-exchange-ids before registering.',
      { tenantId },
      HttpStatus.CONFLICT,
    );
  }
}

/** 502 — the Exchange server rejected or did not accept the registration. */
export class ExchangeRegistrationFailedException extends KaltrosException {
  constructor(tenantId: string, context: Record<string, unknown> = {}) {
    super(
      'EXCHANGE_REGISTRATION_FAILED',
      'Unable to register the business with the Exchange server.',
      { tenantId, ...context },
      HttpStatus.BAD_GATEWAY,
    );
  }
}
