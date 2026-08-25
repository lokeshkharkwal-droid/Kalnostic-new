import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — a communication log/queue row was not found within the caller's tenant. */
export class CommunicationLogNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'COMMUNICATION_LOG_NOT_FOUND',
      'Communication message not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 422 — no active template resolved for the requested feature + channel. */
export class TemplateResolutionFailedException extends KaltrosException {
  constructor(feature: string, channel: string) {
    super(
      'TEMPLATE_RESOLUTION_FAILED',
      'No active template found for this feature and channel',
      { feature, channel },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 400 — the compose payload is inconsistent (e.g. neither a template nor a body
 * was supplied, or a body is required for a free-text send).
 */
export class InvalidComposePayloadException extends KaltrosException {
  constructor(reason: string) {
    super(
      'INVALID_COMPOSE_PAYLOAD',
      reason,
      { reason },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 404 — an in-app notification was not found within the caller's tenant. */
export class NotificationNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'NOTIFICATION_NOT_FOUND',
      'Notification not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 422 — "Share and Inform": the tenant has no activated messaging template for
 * this channel + the requested feature, so the document can't be shared over that
 * channel until a template is activated. Reused by every share flow (lab report,
 * bill, …) via `ShareService`. */
export class ShareTemplateNotActivatedException extends KaltrosException {
  constructor(channel: string) {
    super(
      'SHARE_TEMPLATE_NOT_ACTIVATED',
      `No activated ${channel} template for sharing. Activate one under Templates first.`,
      { channel },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — "Share and Inform": the activated template lacks the provider settings a
 * carrier needs to actually deliver on this channel — SMS needs a DLT
 * `smsTemplateId` + `smsSenderId`; WhatsApp needs the approved-template
 * `smsTemplateId`. Without them the relay accepts the call but the carrier
 * silently drops it, so we fail loudly here instead. */
export class ShareTemplateNotConfiguredException extends KaltrosException {
  constructor(channel: string, missing: string[]) {
    super(
      'SHARE_TEMPLATE_NOT_CONFIGURED',
      `The activated ${channel} template is missing provider settings required for delivery (${missing.join(', ')}). Set them on the template under Templates.`,
      { channel, missing },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 400 — "Share and Inform": no destination address/number available for the
 * chosen channel (neither provided on the request nor on the recipient record). */
export class ShareRecipientMissingException extends KaltrosException {
  constructor(channel: string) {
    super(
      'SHARE_RECIPIENT_MISSING',
      `No ${channel} address/number available for the recipient`,
      { channel },
      HttpStatus.BAD_REQUEST,
    );
  }
}
