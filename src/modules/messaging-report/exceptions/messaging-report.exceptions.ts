import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * 503 — the Exchange gateway credentials (`EXCHANGE_API_URL/KEY/SECRET`) are not
 * configured on this server, so no messaging report can be read.
 */
export class MessagingGatewayNotConfiguredException extends KaltrosException {
  constructor() {
    super(
      'MESSAGING_GATEWAY_NOT_CONFIGURED',
      'The messaging gateway is not configured on this server.',
      {},
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/**
 * 409 — the gateway does not know this tenant ("client not found!"): the business
 * was never registered with the Exchange (SiteAdmin → register-exchange).
 */
export class MessagingTenantNotRegisteredException extends KaltrosException {
  constructor(context: Record<string, unknown> = {}) {
    super(
      'MESSAGING_TENANT_NOT_REGISTERED',
      'This business is not registered with the messaging gateway yet. A site admin must register it before its WhatsApp/SMS reports can load.',
      context,
      HttpStatus.CONFLICT,
    );
  }
}

/** 502 — the Exchange gateway did not answer, or answered with an error. */
export class MessagingGatewayUnavailableException extends KaltrosException {
  constructor(context: Record<string, unknown> = {}) {
    super(
      'MESSAGING_GATEWAY_UNAVAILABLE',
      'Could not load the report from the messaging gateway. Please try again.',
      context,
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/** 400 — `dateFrom` is after `dateTo`. */
export class MessagingReportInvalidDateRangeException extends KaltrosException {
  constructor(dateFrom: string, dateTo: string) {
    super(
      'MESSAGING_REPORT_INVALID_DATE_RANGE',
      'The start date must be on or before the end date.',
      { dateFrom, dateTo },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 404 — the gateway has no such message for this tenant/channel (also used when
 * the gateway returns a message owned by another tenant or channel).
 */
export class MessageNotFoundException extends KaltrosException {
  constructor(id: number, context: Record<string, unknown> = {}) {
    super(
      'MESSAGE_NOT_FOUND',
      'Message not found',
      { id, ...context },
      HttpStatus.NOT_FOUND,
    );
  }
}
