import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — machine not found within the tenant. */
export class MachineNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'MACHINE_NOT_FOUND',
      'Machine not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 404 — adapter log not found for this machine within the tenant. */
export class MachineAdapterLogNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'MACHINE_ADAPTER_LOG_NOT_FOUND',
      'Adapter log not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active machine in this tenant already uses this code. */
export class MachineCodeConflictException extends KaltrosException {
  constructor(code: string) {
    super(
      'MACHINE_CODE_CONFLICT',
      'A machine with this code already exists',
      { code },
      HttpStatus.CONFLICT,
    );
  }
}
