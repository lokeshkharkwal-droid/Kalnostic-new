import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — Overall Result template not found within the tenant. */
export class OverallResultTemplateNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'OVERALL_RESULT_TEMPLATE_NOT_FOUND',
      'Overall result template not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 409 — another active template in this tenant already uses this name.
 */
export class OverallResultTemplateNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'OVERALL_RESULT_TEMPLATE_NAME_CONFLICT',
      'An overall result template with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}
