import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — contact submission not found (or soft-deleted). */
export class ContactSubmissionNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'CONTACT_SUBMISSION_NOT_FOUND',
      'Contact submission not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}
