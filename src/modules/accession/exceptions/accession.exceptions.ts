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
 * Retrieved (and only before the receiving branch has received it) or, once the
 * receiving branch sent it back, repeated / flagged as an error. Extends
 * {@link InvalidSampleTransitionException} so group actions that "skip invalid"
 * samples still skip it instead of failing the whole batch.
 */
export class SampleSentToBranchException extends InvalidSampleTransitionException {
  /** `action` is the button the user pressed; `'reject'` is a transfer action, not a sample one. */
  constructor(action: SampleAction | 'reject', from: SampleStatus) {
    super(
      action as SampleAction,
      from,
      `This sample has been sent to another branch, so "${action}" is not allowed. It can only be retrieved before the receiving branch receives it. Once the receiving branch has sent it back, it can also be repeated (if the receiving branch asked for a repeat) or flagged as an error (if it rejected it).`,
      'SAMPLE_SENT_TO_BRANCH',
    );
  }
}

/**
 * 422 — the sample's order was cancelled, so no accession action is allowed on
 * it. Extends {@link InvalidSampleTransitionException} so group actions that
 * "skip invalid" samples skip it instead of failing the whole batch.
 */
export class SampleOrderCancelledException extends InvalidSampleTransitionException {
  constructor(
    action: SampleAction | 'assign-barcode' | 'update',
    from: SampleStatus,
  ) {
    super(
      action as SampleAction,
      from,
      action === 'retrieve'
        ? 'This order has been cancelled, so Retrieve is not allowed on this sample. Only a sample that is out at another branch can still be retrieved.'
        : action === 'update'
          ? 'This order has been cancelled, so notes can no longer be added to its samples.'
          : `This order has been cancelled, so "${action}" is not allowed on its samples.`,
      'SAMPLE_ORDER_CANCELLED',
    );
  }
}

/**
 * 422 — the order was cancelled and the receiving branch has already ACCEPTED its
 * copy, so the copy cannot be sent back to the sender (Repeat / Reject / Return):
 * that would wipe the results typed on it. Only Store then Discard stay open. Extends
 * {@link InvalidSampleTransitionException} so a group "skip invalid" call skips it
 * with this sentence; it carries the same code as the other cancelled-order refusals.
 */
export class SampleReturnOrderCancelledException extends InvalidSampleTransitionException {
  constructor(action: SampleAction | 'reject', from: SampleStatus) {
    super(
      action as SampleAction,
      from,
      'This order has been cancelled, so this accepted sample cannot be sent back to the sending branch (its results are kept). Store and discard it instead.',
      'SAMPLE_ORDER_CANCELLED',
    );
  }
}

/**
 * 409 — the order behind this transfer was cancelled, so the transfer can no
 * longer be picked up, received, accepted, rejected or repeated.
 */
export class TransferOrderCancelledException extends KaltrosException {
  constructor(transferId: string, action: TransferAction | 'assign-center') {
    super(
      'TRANSFER_ORDER_CANCELLED',
      `This order has been cancelled, so "${action}" is not allowed on its transfer.`,
      { id: transferId, action },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — the test this sample carries was removed from its order, so only the
 * physical-tube wind-down (`store` / `discard`) is still allowed. Extends
 * {@link InvalidSampleTransitionException} so group actions that "skip invalid"
 * samples skip it with this sentence instead of failing the whole batch.
 */
export class SampleItemRemovedException extends InvalidSampleTransitionException {
  constructor(action: SampleAction | 'reject', from: SampleStatus) {
    super(
      action as SampleAction,
      from,
      'This test was removed from the order, so no further work is allowed on it.',
      'SAMPLE_ITEM_REMOVED',
    );
  }
}

/**
 * 409 — the test behind this transfer's sample was removed from its order, so the
 * transfer can no longer be picked up, received, accepted, rejected or repeated
 * (nor have its center assigned).
 */
export class TransferItemRemovedException extends KaltrosException {
  constructor(transferId: string, action: TransferAction | 'assign-center') {
    super(
      'TRANSFER_ITEM_REMOVED',
      'This test was removed from the order, so no further work is allowed on it.',
      { id: transferId, action },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — the all-or-nothing "apply center changes" was refused because ONE tube could
 * not be done (already received, sent back, no permission, ...). Nothing was changed;
 * the message names the tube and says why, and `reasonCode` is the underlying error.
 */
export class CenterChangesRefusedException extends KaltrosException {
  constructor(accessionNo: string, reason: string, reasonCode: string) {
    super(
      'CENTER_CHANGES_REFUSED',
      `Nothing was changed. Tube ${accessionNo}: ${reason}`,
      { accessionNo, reasonCode },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — an INTERNAL transfer that is still In-Transit cannot be picked up yet: the
 * sending branch has not chosen a logistics type, so how it travels is undecided and
 * the receiving branch does not see it. It becomes available once a logistics type
 * is set (at Send, or through Assign / Edit Center). Skippable by group "skip
 * invalid" actions.
 */
export class TransferLogisticsMissingException extends KaltrosException {
  constructor(transferId: string, action: TransferAction) {
    super(
      'TRANSFER_LOGISTICS_MISSING',
      'Logistics type not set by the sending branch yet.',
      { id: transferId, action },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — an OUTSOURCE transfer that has no center and / or no logistics type yet cannot be
 * Picked Up / Received / Accepted (the way an INTERNAL transfer needs a destination and a
 * logistics type). Both are optional when the sample is outsourced and are set later through
 * Assign Center. Skippable by group "skip invalid" actions.
 */
export class TransferOutsourceNotAssignedException extends KaltrosException {
  constructor(transferId: string, action: TransferAction, missing: string[]) {
    super(
      'TRANSFER_OUTSOURCE_NOT_ASSIGNED',
      `This outsource transfer has no ${missing.join(' and no ')} yet. Use Assign Center in In-House Orders to set it, then try again.`,
      { id: transferId, action, missing },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 403 — the caller is working as a branch that has no say in this internal
 * transfer. Pick up / receive / accept / reject / repeat belong to the receiving
 * (destination) branch; Retrieve and Assign Center belong to the sending branch.
 * The caller's ACTIVE branch (the profile they switched to) is what counts, so a
 * person assigned to both branches simply switches profile first.
 */
export class TransferWrongBranchException extends KaltrosException {
  constructor(
    id: string,
    action: TransferAction | 'retrieve' | 'repeat' | 'error' | 'assign-center',
    role: 'receiver' | 'sender',
  ) {
    super(
      'TRANSFER_WRONG_BRANCH',
      role === 'receiver'
        ? `This transfer is addressed to another branch, so "${action}" is not allowed from your current branch. Switch to the receiving branch to act on it.`
        : `Only the sending branch can "${action}" this sample. Switch to the sending branch to do it.`,
      { id, action, role },
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * 422 — Retrieve refused: the receiving branch has already received (or
 * accepted) the sample, or it has already come back from the receiving branch,
 * so there is nothing for the sender to pull back. Skippable by group "skip invalid" actions.
 */
export class RetrieveBlockedException extends InvalidSampleTransitionException {
  constructor(
    from: SampleStatus,
    reason: 'RECEIVED' | 'RETURNED' | 'SENT_BACK',
  ) {
    super(
      'retrieve',
      from,
      reason === 'RECEIVED'
        ? 'The receiving branch has already received this sample, so it can no longer be retrieved.'
        : reason === 'SENT_BACK'
          ? 'The receiving branch has already sent this sample back, so there is nothing to retrieve. Repeat it (if the receiving branch asked for a repeat) or flag it as an error (if it rejected it).'
          : 'This sample is no longer at another branch, so there is nothing to retrieve. Collect it again if it needs repeating.',
      'SAMPLE_RETRIEVE_BLOCKED',
    );
  }
}

/**
 * 422 — the receiving branch cannot Repeat/return a transferred test because its
 * result is already validated there (Result Done, Approved or Published). Work
 * still in progress does not block it: the report is reset on the way back.
 * Skippable by group "skip invalid" actions.
 */
export class SampleReturnBlockedException extends InvalidSampleTransitionException {
  constructor(from: SampleStatus) {
    super(
      'repeat',
      from,
      'The result of this test is already done at this branch (Result Done, Approved or Published), so it cannot be repeated or returned to the sending branch.',
      'SAMPLE_RETURN_BLOCKED',
    );
  }
}

/**
 * 422 — a sample cannot be Repeated because the report it serves already has a
 * validated result (Result Done, Approved or Published); repeating would wipe it.
 * A validated result is redone with Re-run instead. Skippable by group "skip
 * invalid" actions.
 */
export class SampleRepeatBlockedException extends InvalidSampleTransitionException {
  constructor(from: SampleStatus) {
    super(
      'repeat',
      from,
      'The result of this test is already done (Result Done, Approved or Published), so the sample cannot be repeated. Use Re-run to redo a validated result.',
      'SAMPLE_REPEAT_BLOCKED',
    );
  }
}

/**
 * 422 — a sample cannot be Retrieved (the universal undo) back to before its
 * acceptance because a test on it already has a validated result (Result Done,
 * Approved or Published): the sample would say "not accepted yet" while its
 * result is done. A validated result is redone with Re-run instead. Anything
 * earlier (no result, saved, validation pending) does not block. Skippable by
 * group "skip invalid" actions.
 */
export class SampleRetrieveBlockedByResultException extends InvalidSampleTransitionException {
  constructor(from: SampleStatus) {
    super(
      'retrieve',
      from,
      'The result of this test is already done (Result Done, Approved or Published), so the sample cannot be retrieved back to before its acceptance. Use Re-run to redo a validated result.',
      'SAMPLE_RETRIEVE_BLOCKED_RESULT_DONE',
    );
  }
}

/**
 * 422 — the sender cannot Send this sample right now (e.g. it already has an
 * open transfer, or its report at the sending branch has been worked on).
 * Skippable by group "skip invalid" actions.
 */
export class SendBlockedException extends InvalidSampleTransitionException {
  /** `action` names the dispatch that was refused (Send by default; Forward / Outsource too). */
  constructor(
    from: SampleStatus,
    reason: string,
    action: 'send' | 'forward' | 'outsource' = 'send',
  ) {
    super(action, from, reason, 'SAMPLE_SEND_BLOCKED');
  }
}

/**
 * 422 — the destination branch does not offer every test on the tube (it has no active
 * Lab Test List entry for it), so the tube cannot be sent / re-addressed there, and the
 * receiving branch cannot accept it. Skippable by group "skip invalid" actions.
 */
export class DestinationLacksTestException extends InvalidSampleTransitionException {
  constructor(from: SampleStatus, message: string) {
    super('send', from, message, 'DESTINATION_LACKS_TEST');
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
  constructor(id: string, status: TransferStatus, outsource = false) {
    super(
      'TRANSFER_NOT_EDITABLE',
      outsource
        ? 'The center of this outsource transfer can no longer be changed because the outside lab has already received it or it has been closed.'
        : 'The destination of this transfer can no longer be changed because the receiving branch has already received it or it has been closed.',
      { id, status },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — the transfer's center is not the one the Edit Center dialog was showing: it was
 * changed by someone else (or in another tab) after the dialog opened. Refusing keeps a
 * stale screen from silently putting the tube back to the old branch.
 */
export class TransferCenterChangedException extends KaltrosException {
  constructor(
    id: string,
    expectedBranchId: string | null,
    currentBranchId: string | null,
  ) {
    super(
      'TRANSFER_CENTER_CHANGED',
      'The center of this tube was changed by someone else after this dialog was opened. Close the dialog and open it again to see the current center.',
      { id, expectedBranchId, currentBranchId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 409 — the database turned the Assign / Edit Center request away because another request
 * was changing the same rows at that moment (a deadlock or write conflict). The whole
 * request was rolled back, so nothing changed and the user can simply try again.
 */
export class CenterChangesBusyException extends KaltrosException {
  constructor() {
    super(
      'CENTER_CHANGES_BUSY',
      'Someone else is changing these tubes at this moment. Nothing was changed - please try again.',
      undefined,
      HttpStatus.CONFLICT,
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

/**
 * 422 — Assign / Edit Barcode is refused for a sample that is out at another branch,
 * partner or centre (Sent / Forwarded / Outsourced), and for a copy received from
 * another branch: the barcode belongs to the physical tube that travels, and editing
 * one side would leave the tube with two numbers. It becomes editable again once the
 * sample is back in-house (Retrieve). Group "assign barcode" is all-or-nothing, so a
 * selection that includes such a sample is refused as a whole.
 */
export class SampleBarcodeLockedException extends InvalidSampleTransitionException {
  constructor(from: SampleStatus) {
    super(
      'assign-barcode' as SampleAction,
      from,
      "This sample is out at another branch or was received from another branch, so its barcode can't be changed: the barcode belongs to the tube that travelled.",
      'SAMPLE_BARCODE_LOCKED',
    );
  }
}

/**
 * 422 — the manual "outsource status" is only kept for transfers to a third-party
 * lab (kind OUTSOURCE); an internal or external-partner transfer has no such status.
 */
export class TransferNotOutsourceException extends KaltrosException {
  constructor(id: string) {
    super(
      'TRANSFER_NOT_OUTSOURCE',
      'The outsource status can only be set on a transfer to a third-party lab',
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
    const label =
      type === 'multiple_order_label_print'
        ? 'Lab Order Multiple Labels'
        : 'Lab Order Label';
    super(
      'NO_ACTIVE_PRINT_TEMPLATE',
      `No active ${label} template is available to print. Add or activate a ${label} template under Old Templates → Print, or set one under Old Templates → Configuration.`,
      { tenantId, type },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * The sentence a user reads for a refusal. `HttpException.message` is only the
 * class name; the sentence is in the response body (`{ error: { code, message } }`).
 * A group action that SKIPS a sample uses it as the skipped reason, so the screen
 * shows why (e.g. "This order has been cancelled ...") instead of a generic
 * "not allowed from status X".
 */
export function refusalMessage(e: KaltrosException): string {
  const body = e.getResponse() as { error?: { message?: string } };
  return body.error?.message ?? e.message;
}
