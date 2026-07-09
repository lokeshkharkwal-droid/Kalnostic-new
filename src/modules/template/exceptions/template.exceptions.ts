import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — messaging template not found within the caller's tenant + scope. */
export class TemplateNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'TEMPLATE_NOT_FOUND',
      'Template not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}
