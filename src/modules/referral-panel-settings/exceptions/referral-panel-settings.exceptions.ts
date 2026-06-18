import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — referral panel settings template not found within the tenant. */
export class ReferralPanelSettingsNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'REFERRAL_PANEL_SETTINGS_NOT_FOUND',
      'Referral panel settings not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 409 — another active settings template in this tenant already uses this name.
 */
export class ReferralPanelSettingsNameConflictException extends KaltrosException {
  constructor(settingName: string) {
    super(
      'REFERRAL_PANEL_SETTINGS_NAME_CONFLICT',
      'A referral panel settings template with this name already exists',
      { settingName },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 409 — another active settings template in this tenant is already the default
 * for this client type (only one default per client type is allowed).
 */
export class ReferralPanelSettingsDefaultConflictException extends KaltrosException {
  constructor(clientType: string) {
    super(
      'REFERRAL_PANEL_SETTINGS_DEFAULT_CONFLICT',
      'A default referral panel settings template already exists for this client type',
      { clientType },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — the prepaid bonus configuration is internally inconsistent (a `bonusType`
 * was chosen without the amount it requires). `reason` carries the specific rule
 * for server-side logging.
 */
export class InvalidReferralPanelSettingsBonusException extends KaltrosException {
  constructor(reason: string) {
    super(
      'REFERRAL_PANEL_SETTINGS_INVALID_BONUS',
      'The prepaid bonus configuration is invalid',
      { reason },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
