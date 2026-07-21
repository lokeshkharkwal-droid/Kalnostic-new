import { HttpStatus } from '@nestjs/common';
import { SampleStatus, TransferStatus } from '@prisma/client';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';
import { SampleAction } from '../constants/sample-transitions.constant';
import { TransferAction } from '../constants/transfer-transitions.constant';

/** 404 — accession sample not found within the caller's tenant/branch. */
export class AccessionSampleNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'ACCESSION_SAMPLE_NOT_FOUND',
      'Accession sample not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 409 — a per-tenant accession number / barcode collision among active rows. Both
 * are system-generated (`ACC-00001…` / `BAR-…`); a collision indicates a
 * concurrent-counter race and is safe to retry.
 */
export class AccessionNumberConflictException extends KaltrosException {
  constructor(value: string) {
    super(
      'ACCESSION_NUMBER_CONFLICT',
      'Accession number/barcode already exists; please retry',
      { value },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — the requested action is not a legal transition from the sample's current
 * status (per the PDF §A.9 state machine).
 */
export class InvalidSampleTransitionException extends KaltrosException {
  constructor(action: SampleAction, from: SampleStatus) {
    super(
      'INVALID_SAMPLE_TRANSITION',
      `Action "${action}" is not allowed from status ${from}`,
      { action, from },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 404 — sample transfer not found within the caller's tenant. */
export class SampleTransferNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'SAMPLE_TRANSFER_NOT_FOUND',
      'Sample transfer not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 422 — the requested transfer action is not a legal transition from the
 * transfer's current status (per the PDF §B.10 transfer state machine).
 */
export class InvalidTransferTransitionException extends KaltrosException {
  constructor(action: TransferAction, from: TransferStatus) {
    super(
      'INVALID_TRANSFER_TRANSITION',
      `Transfer action "${action}" is not allowed from status ${from}`,
      { action, from },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 404 — the outsource center referenced by an outsource transfer was not found. */
export class OutsourceCenterNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'ACCESSION_OUTSOURCE_CENTER_NOT_FOUND',
      'Outsource center not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 422 — a transfer action requires a destination that has not been assigned yet
 * (e.g. accepting an internal transfer with no destination branch — "Assign
 * Center" first, PDF §A.7).
 */
export class TransferDestinationMissingException extends KaltrosException {
  constructor(id: string) {
    super(
      'TRANSFER_DESTINATION_MISSING',
      'This transfer has no destination assigned yet; assign a center first',
      { id },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
