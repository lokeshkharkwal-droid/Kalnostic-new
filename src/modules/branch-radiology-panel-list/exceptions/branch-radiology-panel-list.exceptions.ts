import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — branch radiology panel list not found within the tenant/branch. */
export class BranchRadiologyPanelListNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'BRANCH_RADIOLOGY_PANEL_LIST_NOT_FOUND',
      'Radiology panel list not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active list in this branch already uses this name. */
export class BranchRadiologyPanelListNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'BRANCH_RADIOLOGY_PANEL_LIST_NAME_CONFLICT',
      'A radiology panel list with this name already exists in this branch',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 — the default Walk-in list cannot be deleted. */
export class DefaultBranchRadiologyPanelListNotDeletableException extends KaltrosException {
  constructor() {
    super(
      'DEFAULT_RADIOLOGY_PANEL_LIST_NOT_DELETABLE',
      'The default Walk-in radiology panel list cannot be deleted',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}
