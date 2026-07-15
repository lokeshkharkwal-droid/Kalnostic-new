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
 * 422 — the order is being saved as an APPOINTMENT but the Diagnostic section is
 * missing (or has no appointment time). Appointments are only created for the
 * Diagnostic section; OPD/Radiology appointment input is ignored for now.
 */
export class DiagnosticAppointmentRequiredException extends KaltrosException {
  constructor() {
    super(
      'DIAGNOSTIC_APPOINTMENT_REQUIRED',
      'Appointments can only be created for Diagnostic orders with an appointment date and time',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
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
