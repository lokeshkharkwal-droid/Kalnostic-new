import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — audit log not found within the tenant. */
export class AuditNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'AUDIT_NOT_FOUND',
      'Audit log not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}
