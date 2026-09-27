import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — branch opd panel not found within the tenant/branch. */
export class BranchOpdPanelNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'BRANCH_OPD_PANEL_NOT_FOUND',
      'Branch opd panel not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active branch opd panel already uses this name. */
export class BranchOpdPanelNameConflictException extends KaltrosException {
  constructor(panelName: string) {
    super(
      'BRANCH_OPD_PANEL_NAME_CONFLICT',
      'A branch opd panel with this name already exists',
      { panelName },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — another active branch opd panel already uses this code. */
export class BranchOpdPanelCodeConflictException extends KaltrosException {
  constructor(panelCode: string) {
    super(
      'BRANCH_OPD_PANEL_CODE_CONFLICT',
      'A branch opd panel with this code already exists',
      { panelCode },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — a variant group already has an active default (one default per source). */
export class BranchOpdPanelDefaultConflictException extends KaltrosException {
  constructor() {
    super(
      'BRANCH_OPD_PANEL_DEFAULT_CONFLICT',
      'This panel already has a default variant in the branch list',
      {},
      HttpStatus.CONFLICT,
    );
  }
}
