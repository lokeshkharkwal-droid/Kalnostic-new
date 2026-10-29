import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — lab panel not found within the tenant / master data. */
export class LabPanelNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'LAB_PANEL_NOT_FOUND',
      'Lab panel not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active lab panel in this master data already uses this name. */
export class LabPanelNameConflictException extends KaltrosException {
  constructor(panelName: string) {
    super(
      'LAB_PANEL_NAME_CONFLICT',
      'A lab panel with this name already exists in this master data',
      { panelName },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — another active lab panel in this master data already uses this code. */
export class LabPanelCodeConflictException extends KaltrosException {
  constructor(panelCode: string) {
    super(
      'LAB_PANEL_CODE_CONFLICT',
      'A lab panel with this code already exists in this master data',
      { panelCode },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — one or more `labTestId`s in the panel's tests do not reference an active
 * lab test in this master data (or contain duplicates).
 */
export class LabPanelTestNotFoundException extends KaltrosException {
  constructor(labTestIds: string[]) {
    super(
      'LAB_PANEL_TEST_NOT_FOUND',
      'One or more tests do not reference an active lab test in this master data',
      { labTestIds },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 409 — an "Import Master Data" job is already running for this tenant (imports
 * run one at a time). `jobId`/`branchId` let the caller attach to that run.
 */
export class MasterDataImportAlreadyRunningException extends KaltrosException {
  constructor(jobId: string, branchId: string, sameBranch: boolean) {
    super(
      'MASTER_DATA_IMPORT_ALREADY_RUNNING',
      sameBranch
        ? 'An import is already running for this branch.'
        : 'Another branch of this business is importing master data. Try again when it finishes.',
      { jobId, branchId, sameBranch },
      HttpStatus.CONFLICT,
    );
  }
}

/** 404 — no import job with this id for the caller's tenant + branch. */
export class MasterDataImportJobNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'MASTER_DATA_IMPORT_JOB_NOT_FOUND',
      'Import job not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}
