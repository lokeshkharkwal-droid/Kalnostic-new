import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 400 — the `:screenKey` route param is not a screen with a date filter. */
export class InvalidDateFilterScreenException extends KaltrosException {
  constructor(screenKey: string) {
    super(
      'USER_PREFERENCE_INVALID_SCREEN',
      'This screen does not support a default date filter',
      { screenKey },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 400 — a CUSTOM range whose start is after its end. */
export class InvalidDateFilterRangeException extends KaltrosException {
  constructor(dateFrom: string, dateTo: string) {
    super(
      'USER_PREFERENCE_INVALID_DATE_RANGE',
      'The start date must be on or before the end date',
      { dateFrom, dateTo },
      HttpStatus.BAD_REQUEST,
    );
  }
}
