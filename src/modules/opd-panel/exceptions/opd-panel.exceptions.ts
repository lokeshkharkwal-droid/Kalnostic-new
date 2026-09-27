import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — opd panel not found within the tenant / master data. */
export class OpdPanelNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'OPD_PANEL_NOT_FOUND',
      'Opd panel not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active opd panel in this master data already uses this name. */
export class OpdPanelNameConflictException extends KaltrosException {
  constructor(panelName: string) {
    super(
      'OPD_PANEL_NAME_CONFLICT',
      'A opd panel with this name already exists in this master data',
      { panelName },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — another active opd panel in this master data already uses this code. */
export class OpdPanelCodeConflictException extends KaltrosException {
  constructor(panelCode: string) {
    super(
      'OPD_PANEL_CODE_CONFLICT',
      'A opd panel with this code already exists in this master data',
      { panelCode },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — one or more `testId`s in the panel's tests do not reference an active
 * opd test in this master data (or contain duplicates).
 */
export class OpdPanelTestNotFoundException extends KaltrosException {
  constructor(testIds: string[]) {
    super(
      'OPD_PANEL_TEST_NOT_FOUND',
      'One or more tests do not reference an active opd test in this master data',
      { testIds },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
