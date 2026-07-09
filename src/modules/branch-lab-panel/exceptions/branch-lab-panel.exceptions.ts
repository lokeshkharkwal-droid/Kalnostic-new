import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — branch lab panel not found within the tenant/branch. */
export class BranchLabPanelNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'BRANCH_LAB_PANEL_NOT_FOUND',
      'Branch lab panel not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active branch lab panel already uses this name. */
export class BranchLabPanelNameConflictException extends KaltrosException {
  constructor(panelName: string) {
    super(
      'BRANCH_LAB_PANEL_NAME_CONFLICT',
      'A branch lab panel with this name already exists',
      { panelName },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — another active branch lab panel already uses this code. */
export class BranchLabPanelCodeConflictException extends KaltrosException {
  constructor(panelCode: string) {
    super(
      'BRANCH_LAB_PANEL_CODE_CONFLICT',
      'A branch lab panel with this code already exists',
      { panelCode },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — a variant group already has an active default (one default per source). */
export class BranchLabPanelDefaultConflictException extends KaltrosException {
  constructor() {
    super(
      'BRANCH_LAB_PANEL_DEFAULT_CONFLICT',
      'This panel already has a default variant in the branch list',
      {},
      HttpStatus.CONFLICT,
    );
  }
}
