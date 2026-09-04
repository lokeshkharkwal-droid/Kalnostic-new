import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — adapter log not found within the tenant. */
export class AdapterLogNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'ADAPTER_LOG_NOT_FOUND',
      'Adapter log not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}
