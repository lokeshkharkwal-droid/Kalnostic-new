import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — PDF report template not found within the tenant. */
export class PdfReportTemplateNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'PDF_REPORT_TEMPLATE_NOT_FOUND',
      'PDF report template not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active template in this tenant already uses this name. */
export class PdfReportTemplateNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'PDF_REPORT_TEMPLATE_NAME_CONFLICT',
      'A PDF report template with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 — the supplied `type` is not a supported template type key. */
export class InvalidPdfReportTemplateTypeException extends KaltrosException {
  constructor(type: string) {
    super(
      'INVALID_PDF_REPORT_TEMPLATE_TYPE',
      'Unsupported PDF report template type',
      { type },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 400 — a Configuration `slotKey` is not a known document slot. */
export class InvalidPdfTemplateConfigSlotException extends KaltrosException {
  constructor(slotKey: string) {
    super(
      'INVALID_PDF_TEMPLATE_CONFIG_SLOT',
      'Unknown PDF template configuration slot',
      { slotKey },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 500 — the PDF could not be rendered from the template. */
export class PdfGenerationFailedException extends KaltrosException {
  constructor(id: string, cause?: string) {
    super(
      'PDF_GENERATION_FAILED',
      'Failed to generate the PDF from this template',
      { id, cause },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
