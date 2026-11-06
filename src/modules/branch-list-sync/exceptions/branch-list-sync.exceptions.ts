import { HttpStatus } from '@nestjs/common';
import { BranchListSyncKind } from '@prisma/client';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * 409 — a "Sync from Master Data" of the same kind (lab tests / lab panels) is
 * already running for this branch. Syncs of one kind run one at a time per branch
 * (partial unique index on RUNNING); the caller can attach via `getActive`.
 */
export class BranchListSyncAlreadyRunningException extends KaltrosException {
  constructor(jobId: string, branchId: string, kind: BranchListSyncKind) {
    super(
      'BRANCH_LIST_SYNC_ALREADY_RUNNING',
      'A sync is already running for this list. It will finish on its own — open it to see progress.',
      { jobId, branchId, kind },
      HttpStatus.CONFLICT,
    );
  }
}

/** 404 — no sync job with this id for the caller's tenant + branch. */
export class BranchListSyncJobNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'BRANCH_LIST_SYNC_JOB_NOT_FOUND',
      'Sync job not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}
