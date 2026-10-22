import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — the radiology certificate does not exist in the caller's tenant/master data. */
export class RadiologyCertificateNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'RADIOLOGY_CERTIFICATE_NOT_FOUND',
      'Radiology certificate not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — a radiology certificate with this name already exists in the master data. */
export class RadiologyCertificateNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'RADIOLOGY_CERTIFICATE_NAME_CONFLICT',
      'A radiology certificate with this name already exists in this master data',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}
