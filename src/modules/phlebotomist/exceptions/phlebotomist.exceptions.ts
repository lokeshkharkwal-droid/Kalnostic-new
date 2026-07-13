import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — phlebotomist not found within the tenant. */
export class PhlebotomistNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'PHLEBOTOMIST_NOT_FOUND',
      'Phlebotomist not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}
