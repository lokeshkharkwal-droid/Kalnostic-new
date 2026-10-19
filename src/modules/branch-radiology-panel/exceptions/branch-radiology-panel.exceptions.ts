import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — branch radiology panel not found within the tenant/branch. */
export class BranchRadiologyPanelNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'BRANCH_RADIOLOGY_PANEL_NOT_FOUND',
      'Branch radiology panel not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active branch radiology panel already uses this name. */
export class BranchRadiologyPanelNameConflictException extends KaltrosException {
  constructor(panelName: string) {
    super(
      'BRANCH_RADIOLOGY_PANEL_NAME_CONFLICT',
      'A branch radiology panel with this name already exists',
      { panelName },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — another active branch radiology panel already uses this code. */
export class BranchRadiologyPanelCodeConflictException extends KaltrosException {
  constructor(panelCode: string) {
    super(
      'BRANCH_RADIOLOGY_PANEL_CODE_CONFLICT',
      'A branch radiology panel with this code already exists',
      { panelCode },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — a variant group already has an active default (one default per source). */
export class BranchRadiologyPanelDefaultConflictException extends KaltrosException {
  constructor() {
    super(
      'BRANCH_RADIOLOGY_PANEL_DEFAULT_CONFLICT',
      'This panel already has a default variant in the branch list',
      {},
      HttpStatus.CONFLICT,
    );
  }
}
