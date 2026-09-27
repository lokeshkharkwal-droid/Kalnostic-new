import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — branch opd panel list not found within the tenant/branch. */
export class BranchOpdPanelListNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'BRANCH_OPD_PANEL_LIST_NOT_FOUND',
      'Opd panel list not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active list in this branch already uses this name. */
export class BranchOpdPanelListNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'BRANCH_OPD_PANEL_LIST_NAME_CONFLICT',
      'A opd panel list with this name already exists in this branch',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 — the default Walk-in list cannot be deleted. */
export class DefaultBranchOpdPanelListNotDeletableException extends KaltrosException {
  constructor() {
    super(
      'DEFAULT_OPD_PANEL_LIST_NOT_DELETABLE',
      'The default Walk-in opd panel list cannot be deleted',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}
