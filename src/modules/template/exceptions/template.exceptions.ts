import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — template not found within the caller's tenant + scope. */
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

/**
 * 409 — another active template in the same scope (tenant or branch) already
 * uses this name for this type.
 */
export class TemplateNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'TEMPLATE_NAME_CONFLICT',
      'A template with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 400 — the supplied payload is inconsistent with the template `type` beyond
 * what class-validator can express (e.g. a required type-specific block is
 * missing on create).
 */
export class InvalidTemplateConfigException extends KaltrosException {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('INVALID_TEMPLATE_CONFIG', message, context, HttpStatus.BAD_REQUEST);
  }
}
