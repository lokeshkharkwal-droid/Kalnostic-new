import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * 404 — the lab order does not exist, is not in the patient's scope (their own
 * records or a linked family member's) or is not a lab order. One generic
 * response for every case so a patient cannot probe other people's order ids.
 */
export class PatientLabOrderNotFoundException extends KaltrosException {
  constructor(orderId: string) {
    super(
      'PATIENT_LAB_ORDER_NOT_FOUND',
      'Lab order not found',
      { orderId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * The report cannot be shown to the patient right now. The client message is
 * deliberately neutral — whatever the real cause (nothing published, the
 * referrer's credit restriction, no print template, a cancelled order) the
 * patient only learns to contact the lab. The real cause is kept in `context`
 * (logged server-side, never returned) so the lab's private figures — a
 * referrer's outstanding amount or credit limit — never reach a patient.
 */
export class PatientReportNotAvailableException extends KaltrosException {
  constructor(
    reason: string,
    context: Record<string, unknown> = {},
    statusCode: number = HttpStatus.FORBIDDEN,
  ) {
    super(
      'PATIENT_REPORT_NOT_AVAILABLE',
      'Report not available. Please contact the lab.',
      { reason, ...context },
      statusCode,
    );
  }
}
