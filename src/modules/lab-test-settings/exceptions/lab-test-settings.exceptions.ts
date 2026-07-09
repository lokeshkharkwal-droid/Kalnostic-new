import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

export class LabImageSettingNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'LAB_IMAGE_SETTING_NOT_FOUND',
      'Lab image setting not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class LabPdfSettingNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'LAB_PDF_SETTING_NOT_FOUND',
      'Lab PDF setting not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class LabGroupLayoutSettingNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'LAB_GROUP_LAYOUT_SETTING_NOT_FOUND',
      'Lab group layout setting not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class LabIconSettingNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'LAB_ICON_SETTING_NOT_FOUND',
      'Lab icon setting not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 400 — the metadata `icons` array length doesn't match the uploaded files. */
export class IconFileMismatchException extends KaltrosException {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('ICON_FILE_MISMATCH', message, context, HttpStatus.BAD_REQUEST);
  }
}

/** 400 — the metadata JSON field could not be parsed. */
export class InvalidIconSettingPayloadException extends KaltrosException {
  constructor(message: string) {
    super('INVALID_ICON_SETTING_PAYLOAD', message, {}, HttpStatus.BAD_REQUEST);
  }
}
