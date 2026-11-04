import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * Thrown when a QR Code Scan save references a print template that does not exist
 * in the caller's tenant (or is the wrong template `type`). Keeps one branch from
 * pointing at another tenant's template id.
 */
export class QrScanTemplateNotFoundException extends KaltrosException {
  constructor(templateId: string, expectedType: string) {
    super(
      'QR_SCAN_TEMPLATE_NOT_FOUND',
      'The selected print template could not be found. Please pick another template.',
      { templateId, expectedType },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
