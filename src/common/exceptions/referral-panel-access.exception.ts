import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from './kaltros.exception';

/**
 * Thrown when a B2B Referring Panel user tries to read a record (order, invoice,
 * payment, report) that belongs to a different referral panel — the defence
 * against URL/ID manipulation.
 */
export class ReferralPanelAccessDeniedException extends KaltrosException {
  /**
   * @param resource the resource kind that was denied (for the server log context)
   * @param id the record id that was requested
   */
  constructor(resource: string, id: string) {
    super(
      'REFERRAL_PANEL_ACCESS_DENIED',
      'You do not have access to this record.',
      { resource, id },
      HttpStatus.FORBIDDEN,
    );
  }
}
