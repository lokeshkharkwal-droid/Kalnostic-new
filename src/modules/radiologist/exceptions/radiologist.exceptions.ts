import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — radiologist not found within the tenant. */
export class RadiologistNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'RADIOLOGIST_NOT_FOUND',
      'Radiologist not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 422 — the referenced department does not exist in the caller's tenant. */
export class RadiologistDepartmentNotFoundException extends KaltrosException {
  constructor(departmentId: string) {
    super(
      'RADIOLOGIST_DEPARTMENT_NOT_FOUND',
      'The referenced department does not exist in this tenant',
      { departmentId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
