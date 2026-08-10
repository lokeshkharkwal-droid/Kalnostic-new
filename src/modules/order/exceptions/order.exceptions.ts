import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — order not found within the tenant. */
export class OrderNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('ORDER_NOT_FOUND', 'Order not found', { id }, HttpStatus.NOT_FOUND);
  }
}

/** 409 — another active order in this tenant already uses this code. */
export class OrderCodeConflictException extends KaltrosException {
  constructor(orderCode: string) {
    super(
      'ORDER_CODE_CONFLICT',
      'An order with this code already exists',
      { orderCode },
      HttpStatus.CONFLICT,
    );
  }
}

/** 422 — the referenced patient does not exist in the caller's tenant. */
export class OrderPatientNotFoundException extends KaltrosException {
  constructor(patientId: string) {
    super(
      'ORDER_PATIENT_NOT_FOUND',
      'The referenced patient does not exist in this tenant',
      { patientId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — an order item is malformed: it must reference exactly one of a branch
 * lab test, a branch lab panel, or a direct entry (never none, never more than
 * one).
 */
export class InvalidOrderItemException extends KaltrosException {
  constructor(reason: string) {
    super(
      'INVALID_ORDER_ITEM',
      'Each order item must reference exactly one of a branch lab test, a branch lab panel, or a direct entry',
      { reason },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — one or more branch lab tests do not exist in the caller's tenant. */
export class OrderBranchLabTestNotFoundException extends KaltrosException {
  constructor(ids: string[]) {
    super(
      'ORDER_BRANCH_LAB_TEST_NOT_FOUND',
      'One or more branch lab tests do not exist in this tenant',
      { ids },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — one or more branch lab panels do not exist in the caller's tenant. */
export class OrderBranchLabPanelNotFoundException extends KaltrosException {
  constructor(ids: string[]) {
    super(
      'ORDER_BRANCH_LAB_PANEL_NOT_FOUND',
      'One or more branch lab panels do not exist in this tenant',
      { ids },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the referenced diagnostic panel does not exist in the caller's tenant. */
export class OrderDiagnosticPanelNotFoundException extends KaltrosException {
  constructor(diagnosticPanelId: string) {
    super(
      'ORDER_DIAGNOSTIC_PANEL_NOT_FOUND',
      'The referenced diagnostic panel does not exist in this tenant',
      { diagnosticPanelId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — the referenced OPD doctor does not exist in the tenant or is not a
 * CONSULTANT doctor.
 */
export class OrderConsultantDoctorNotFoundException extends KaltrosException {
  constructor(doctorId: string) {
    super(
      'ORDER_CONSULTANT_DOCTOR_NOT_FOUND',
      'The referenced doctor does not exist in this tenant or is not a consultant',
      { doctorId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — a referenced department does not exist in the caller's tenant. */
export class OrderDepartmentNotFoundException extends KaltrosException {
  constructor(departmentId: string) {
    super(
      'ORDER_DEPARTMENT_NOT_FOUND',
      'The referenced department does not exist in this tenant',
      { departmentId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — a referenced category does not exist in the caller's tenant. */
export class OrderCategoryNotFoundException extends KaltrosException {
  constructor(categoryId: string) {
    super(
      'ORDER_CATEGORY_NOT_FOUND',
      'The referenced category does not exist in this tenant',
      { categoryId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the referenced referral doctor does not exist in the caller's tenant. */
export class OrderReferralDoctorNotFoundException extends KaltrosException {
  constructor(referredByDoctorId: string) {
    super(
      'ORDER_REFERRAL_DOCTOR_NOT_FOUND',
      'The referenced referral doctor does not exist in this tenant',
      { referredByDoctorId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the referenced referral (B2B) panel does not exist in the caller's tenant. */
export class OrderReferralPanelNotFoundException extends KaltrosException {
  constructor(referralPanelId: string) {
    super(
      'ORDER_REFERRAL_PANEL_NOT_FOUND',
      'The referenced referral panel does not exist in this tenant',
      { referralPanelId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the referenced internal referral does not exist in the caller's tenant. */
export class OrderInternalReferralNotFoundException extends KaltrosException {
  constructor(internalReferralId: string) {
    super(
      'ORDER_INTERNAL_REFERRAL_NOT_FOUND',
      'The referenced internal referral does not exist in this tenant',
      { internalReferralId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the referenced external referral does not exist in the caller's tenant. */
export class OrderExternalReferralNotFoundException extends KaltrosException {
  constructor(externalReferralId: string) {
    super(
      'ORDER_EXTERNAL_REFERRAL_NOT_FOUND',
      'The referenced external referral does not exist in this tenant',
      { externalReferralId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — the order is being saved as an APPOINTMENT but none of its service
 * sections (Diagnostic / OPD / Radiology) carries an appointment date and time.
 * An appointment order must have exactly one section scheduled.
 */
export class AppointmentSectionRequiredException extends KaltrosException {
  constructor() {
    super(
      'APPOINTMENT_SECTION_REQUIRED',
      'An appointment order must have a Diagnostic, OPD, or Radiology section with an appointment date and time',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — the order is being created as, or a draft is being finalized to, a live
 * status (`ORDER` / `QUOTE` / `APPOINTMENT`) but carries no items. A live order
 * must reference at least one lab test, panel, or direct entry.
 */
export class OrderRequiresItemsException extends KaltrosException {
  constructor() {
    super(
      'ORDER_REQUIRES_ITEMS',
      'Add at least one lab test, panel or item before finalizing the order',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — a home-visit diagnostics order is being finalized without a
 * phlebotomist assigned.
 */
export class OrderHomeVisitPhlebotomistRequiredException extends KaltrosException {
  constructor() {
    super(
      'ORDER_HOME_VISIT_PHLEBOTOMIST_REQUIRED',
      'Select a phlebotomist for the home visit',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — a home-visit diagnostics order is being finalized without a collection
 * date and time slot.
 */
export class OrderHomeVisitSlotRequiredException extends KaltrosException {
  constructor() {
    super(
      'ORDER_HOME_VISIT_SLOT_REQUIRED',
      'Select an available collection date and time for the home visit',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 409 — the order is already cancelled, so it can't be cancelled again. */
export class OrderAlreadyCancelledException extends KaltrosException {
  constructor(id: string) {
    super(
      'ORDER_ALREADY_CANCELLED',
      'This order is already cancelled',
      { id },
      HttpStatus.CONFLICT,
    );
  }
}

/** 404 — the order item does not exist on this order within the tenant. */
export class OrderItemNotFoundException extends KaltrosException {
  constructor(orderId: string, itemId: string) {
    super(
      'ORDER_ITEM_NOT_FOUND',
      'Order item not found',
      { orderId, itemId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 422 — a referenced person does not exist (or is inactive). Covers the
 * radiology technician (a `Person`). The `field` identifies which reference
 * failed.
 */
export class OrderPersonNotFoundException extends KaltrosException {
  constructor(field: string, personId: string) {
    super(
      'ORDER_PERSON_NOT_FOUND',
      'The referenced person does not exist',
      { field, personId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — an order item's chosen outsource center does not exist or is inactive. */
export class OrderOutsourceCenterNotFoundException extends KaltrosException {
  constructor(outsourceCenterId: string) {
    super(
      'ORDER_OUTSOURCE_CENTER_NOT_FOUND',
      'The chosen outsource center does not exist or is inactive',
      { outsourceCenterId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — the chosen outsource center is not configured to handle this item's
 * test/panel (`OutsourceCenter.labTestId`/`labPanelId` doesn't match).
 */
export class OrderOutsourceCenterNotEligibleException extends KaltrosException {
  constructor(outsourceCenterId: string, itemRef: string) {
    super(
      'ORDER_OUTSOURCE_CENTER_NOT_ELIGIBLE',
      'The chosen outsource center is not configured to handle this test/panel',
      { outsourceCenterId, itemRef },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 404 — Print (order-console's "Print Order" action) has no active
 * PDF template of the requested `type` to render with. The tenant must
 * create one via `PdfReportTemplateModule` (or the caller must pass an
 * explicit `templateId`) before an order can be printed. */
export class NoActiveOrderPrintTemplateException extends KaltrosException {
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
export class AmbiguousOrderPrintTemplateException extends KaltrosException {
  constructor(tenantId: string, type: string, templateIds: string[]) {
    super(
      'AMBIGUOUS_PRINT_TEMPLATE',
      `Multiple active ${type} PDF templates exist — specify templateId`,
      { tenantId, type, templateIds },
      HttpStatus.CONFLICT,
    );
  }
}

/** 422 — the order being duplicated did not originate as a quotation. */
export class NotAQuotationException extends KaltrosException {
  constructor(id: string) {
    super(
      'ORDER_NOT_A_QUOTATION',
      'Only quotations can be duplicated',
      { id },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the quotation is still within its validity window (only expired
 * quotations may be duplicated). */
export class QuotationNotExpiredException extends KaltrosException {
  constructor(id: string) {
    super(
      'QUOTATION_NOT_EXPIRED',
      'Only expired quotations can be duplicated',
      { id },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 403 — the branch's Registration setting forbids duplicating expired
 * quotations. */
export class QuotationDuplicationNotAllowedException extends KaltrosException {
  constructor(id: string) {
    super(
      'QUOTATION_DUPLICATION_NOT_ALLOWED',
      'Duplicating expired quotations is disabled for this branch',
      { id },
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * 422 — the patient has outstanding previous dues that must be cleared before a
 * new order can be created (the branch's `Allow Order Without Clearing Previous
 * Dues` is off and the amount cleared on this order is below the required
 * minimum). `required` is `min(outstanding, MinimumPreviousDuesToClear)`.
 */
export class PreviousDuesNotClearedException extends KaltrosException {
  constructor(outstanding: number, required: number, cleared: number) {
    super(
      'PREVIOUS_DUES_NOT_CLEARED',
      `The patient has outstanding previous dues. Clear at least ${required} before creating a new order`,
      { outstanding, required, cleared },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — the amount being cleared toward previous dues exceeds the patient's
 * actual outstanding balance (you can't clear more dues than are owed).
 */
export class PreviousDuesOverpaymentException extends KaltrosException {
  constructor(outstanding: number, cleared: number) {
    super(
      'PREVIOUS_DUES_OVERPAYMENT',
      `The entered amount cannot exceed the patient's total outstanding dues (${outstanding})`,
      { outstanding, cleared },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — the branch does not allow partial billing, so the full net amount must
 * be collected before the order can be completed.
 */
export class FullPaymentRequiredException extends KaltrosException {
  constructor(netAmount: number, paidAmount: number) {
    super(
      'FULL_PAYMENT_REQUIRED',
      'Partial billing is disabled for this branch — collect the full net amount before completing the order',
      { netAmount, paidAmount },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — partial billing is allowed but the amount paid is below the branch's
 * configured minimum percentage of the net amount required to proceed.
 */
export class PartialPaymentBelowMinimumException extends KaltrosException {
  constructor(
    netAmount: number,
    paidAmount: number,
    minimumPercent: number,
    minimumRequired: number,
  ) {
    super(
      'PARTIAL_PAYMENT_BELOW_MINIMUM',
      `At least ${minimumPercent}% of the net amount (${minimumRequired}) must be collected before the order can be completed`,
      { netAmount, paidAmount, minimumPercent, minimumRequired },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — the branch's external order/quote id format is NONE (manual entry) but
 * no `externalOrderId` was supplied for a finalized order/quotation.
 */
export class ExternalOrderIdRequiredException extends KaltrosException {
  constructor(isQuote: boolean) {
    super(
      'EXTERNAL_ORDER_ID_REQUIRED',
      isQuote ? 'A Quote ID is required' : 'An Order ID is required',
      { isQuote },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 409 — another active order in this branch already uses this external id. */
export class DuplicateExternalOrderIdException extends KaltrosException {
  constructor(externalOrderId: string) {
    super(
      'DUPLICATE_EXTERNAL_ORDER_ID',
      'This ID is already in use in this branch',
      { externalOrderId },
      HttpStatus.CONFLICT,
    );
  }
}
