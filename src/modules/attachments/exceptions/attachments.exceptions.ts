import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — attachment not found within the tenant. */
export class AttachmentNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'ATTACHMENT_NOT_FOUND',
      'Attachment not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}
