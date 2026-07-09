import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — support-information record not found (or soft-deleted). */
export class SupportInfoNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'SUPPORT_INFO_NOT_FOUND',
      'Support information not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active support-information record already uses this title. */
export class SupportInfoTitleConflictException extends KaltrosException {
  constructor(title: string) {
    super(
      'SUPPORT_INFO_TITLE_CONFLICT',
      'A support information record with this title already exists',
      { title },
      HttpStatus.CONFLICT,
    );
  }
}
