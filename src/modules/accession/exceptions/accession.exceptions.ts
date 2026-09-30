import { HttpStatus } from '@nestjs/common';
import { SampleStatus, TransferStatus } from '@prisma/client';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';
import { SampleAction } from '../constants/sample-transitions.constant';
import { TransferAction } from '../constants/transfer-transitions.constant';

/** 404 — accession sample not found within the caller's tenant/branch. */
export class OrderSampleNotFoundException extends KaltrosException {
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
  /**
   * @param message optional user-facing override (subclasses give a specific
   *   reason); defaults to the generic "not allowed from status" text
   * @param code optional error-code override for the same purpose
   */
  constructor(
    action: SampleAction,
    from: SampleStatus,
    message?: string,
    code = 'INVALID_SAMPLE_TRANSITION',
  ) {
    super(
      code,
      message ?? `Action "${action}" is not allowed from status ${from}`,
      { action, from },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — a sample already sent to another branch (`SENT_INTERNAL`) can only be
 * Retrieved (and only before the receiving branch has received it). Extends
 * {@link InvalidSampleTransitionException} so group actions that "skip invalid"
 * samples still skip it instead of failing the whole batch.
 */
export class SampleSentToBranchException extends InvalidSampleTransitionException {
  constructor(action: SampleAction, from: SampleStatus) {
    super(
      action,
      from,
      `This sample has been sent to another branch, so "${action}" is not allowed. It can only be retrieved before the receiving branch receives it, or returned by the receiving branch.`,
      'SAMPLE_SENT_TO_BRANCH',
    );
  }
}

/**
 * 422 — Retrieve refused: the receiving branch has already received (or
 * accepted) the sample, or it has already come back from the receiving branch,
 * so there is nothing for the sender to pull back. Skippable by group "skip invalid" actions.
 */
export class RetrieveBlockedException extends InvalidSampleTransitionException {
  constructor(from: SampleStatus, reason: 'RECEIVED' | 'RETURNED') {
    super(
      'retrieve',
      from,
      reason === 'RECEIVED'
        ? 'The receiving branch has already received this sample, so it can no longer be retrieved.'
        : 'This sample is no longer at another branch, so there is nothing to retrieve. Collect it again if it needs repeating.',
      'SAMPLE_RETRIEVE_BLOCKED',
    );
  }
}

/**
 * 422 — the receiving branch cannot Repeat/return a transferred test because it
 * has already been worked on there (the report is past PENDING or already holds
 * results, notes or attachments). Skippable by group "skip invalid" actions.
 */
export class SampleReturnBlockedException extends InvalidSampleTransitionException {
  constructor(from: SampleStatus) {
    super(
      'repeat',
      from,
      'This test has already been worked on at this branch (its report has results, notes or attachments, or is past Pending), so it cannot be repeated or returned to the sending branch.',
      'SAMPLE_RETURN_BLOCKED',
    );
  }
}

/**
 * 422 — the sender cannot Send this sample right now (e.g. it already has an
 * open transfer, or its report at the sending branch has been worked on).
 * Skippable by group "skip invalid" actions.
 */
export class SendBlockedException extends InvalidSampleTransitionException {
  constructor(from: SampleStatus, reason: string) {
    super('send', from, reason, 'SAMPLE_SEND_BLOCKED');
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

/**
 * 422 — the transfer's destination can no longer be changed: the receiving branch
 * has already received/accepted it or it was returned/rejected.
 */
export class TransferNotEditableException extends KaltrosException {
  constructor(id: string, status: TransferStatus) {
    super(
      'TRANSFER_NOT_EDITABLE',
      'The destination of this transfer can no longer be changed because the receiving branch has already received it or it has been closed.',
      { id, status },
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

/** 404 — Print Label (in-house/referral/external-referral orders' "Label
 * Print" action) has no active PDF template of the requested `type`
 * (`order_label_print` or `multiple_order_label_print`) to render with. */
export class NoActiveLabelTemplateException extends KaltrosException {
  constructor(tenantId: string, type: string) {
    super(
      'NO_ACTIVE_PRINT_TEMPLATE',
      `No active ${type} PDF template is configured for this tenant`,
      { tenantId, type },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — more than one active template of the requested `type` exists and
 * the caller did not specify which one to use. */
export class AmbiguousLabelTemplateException extends KaltrosException {
  constructor(tenantId: string, type: string, templateIds: string[]) {
    super(
      'AMBIGUOUS_PRINT_TEMPLATE',
      `Multiple active ${type} PDF templates exist — specify templateId`,
      { tenantId, type, templateIds },
      HttpStatus.CONFLICT,
    );
  }
}
