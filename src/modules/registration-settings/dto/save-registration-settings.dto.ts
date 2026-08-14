import {
  ExternalIdFormat,
  PaymentMode,
  RepeatIntervalUnit,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/**
 * Save/upsert payload for the active branch's Registration settings. All
 * fields are optional so the frontend can patch a single card or submit the
 * whole form. Field names mirror the LIMS Settings doc's `<Heading>_<Setting>`
 * layout 1:1. ID-generation config (Order/Quotation/Appointment/Patient-UMID)
 * is saved separately via `SaveRegistrationIdSequenceDto`.
 */
export class SaveRegistrationSettingsDto {
  // ── General ──
  @IsOptional() @IsBoolean() General_AllowAddPatientPhoto?: boolean;
  @IsOptional() @IsBoolean() General_ViewMedicalHistory?: boolean;
  @IsOptional() @IsBoolean() General_ViewPastOrders?: boolean;
  @IsOptional() @IsBoolean() General_AllowEditingOrderDate?: boolean;
  @IsOptional() @IsBoolean() General_AllowEditingPaymentDate?: boolean;
  @IsOptional() @IsEnum(PaymentMode) General_DefaultPaymentMode?: PaymentMode;

  // ── Order ID Configuration ──
  @IsOptional()
  @IsEnum(ExternalIdFormat)
  OrderIdConfiguration_AutoIncrementExternalOrderIdFormat?: ExternalIdFormat;

  // ── Quotation (non-ID fields) ──
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  Quotation_QuotationValidityValue?: number;

  @IsOptional()
  @IsEnum(ExternalIdFormat)
  Quotation_AutoIncrementExternalQuoteIdFormat?: ExternalIdFormat;

  @IsOptional()
  @IsEnum(RepeatIntervalUnit)
  Quotation_QuotationValidityUnit?: RepeatIntervalUnit;

  @IsOptional()
  @IsBoolean()
  Quotation_AllowDuplicationOfExpiredQuotation?: boolean;

  // ── Charges & Deductions ──
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  ChargesAndDeductions_VisitChargesAmount?: number;

  @IsOptional()
  @IsBoolean()
  ChargesAndDeductions_VisitChargesEditable?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  ChargesAndDeductions_SampleCollectionChargesAmount?: number;

  @IsOptional()
  @IsBoolean()
  ChargesAndDeductions_SampleCollectionChargesEditable?: boolean;

  @IsOptional()
  @IsBoolean()
  ChargesAndDeductions_AllowWalletDeduction?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ChargesAndDeductions_MaximumWalletDeductionPercent?: number;

  @IsOptional()
  @IsBoolean()
  ChargesAndDeductions_AllowLoyaltyDeduction?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  ChargesAndDeductions_MaximumLoyaltyPointsEquivalentAmount?: number;

  @IsOptional()
  @IsBoolean()
  ChargesAndDeductions_AllowClearPreviousDues?: boolean;

  @IsOptional()
  @IsBoolean()
  ChargesAndDeductions_AllowOrderWithoutClearingPreviousDues?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  ChargesAndDeductions_MinimumPreviousDuesToClear?: number;

  @IsOptional()
  @IsBoolean()
  ChargesAndDeductions_AllowPartialBilling?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ChargesAndDeductions_MinimumPercentOfNetAmountToProceed?: number;

  @IsOptional() @IsBoolean() ChargesAndDeductions_TdsApplicable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ChargesAndDeductions_MinimumTdsPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ChargesAndDeductions_MaximumTdsPercent?: number;

  @IsOptional() @IsBoolean() ChargesAndDeductions_AllowDiscounts?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ChargesAndDeductions_MinimumDiscountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ChargesAndDeductions_MaximumDiscountPercent?: number;

  @IsOptional()
  @IsBoolean()
  ChargesAndDeductions_AllowLineItemDiscount?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ChargesAndDeductions_MinimumLineItemDiscountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ChargesAndDeductions_MaximumLineItemDiscountPercent?: number;

  @IsOptional()
  @IsBoolean()
  ChargesAndDeductions_AllowPartialBillingOfDiscountedOrder?: boolean;

  @IsOptional()
  @IsBoolean()
  ChargesAndDeductions_AllowOrderDiscountOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  ChargesAndDeductions_AllowLineDiscountOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  ChargesAndDeductions_AllowBothOrderAndLineDiscount?: boolean;

  // ── Cancellation & Refund ──
  @IsOptional()
  @IsBoolean()
  CancellationAndRefund_AllowOrderCancellation?: boolean;

  @IsOptional()
  @IsBoolean()
  CancellationAndRefund_AllowPartialCancellation?: boolean;

  @IsOptional() @IsBoolean() CancellationAndRefund_AllowRefund?: boolean;

  @IsOptional()
  @IsBoolean()
  CancellationAndRefund_AllowPartialRefund?: boolean;

  @IsOptional()
  @IsBoolean()
  CancellationAndRefund_CancellationChargesApplicable?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  CancellationAndRefund_CancellationChargesAmount?: number;

  @IsOptional()
  @IsBoolean()
  CancellationAndRefund_RefundChargesApplicable?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  CancellationAndRefund_RefundChargesAmount?: number;

  // ── Referral & Staff Permissions ──
  @IsOptional()
  @IsBoolean()
  ReferralAndStaffPermissions_AllowAddReferral?: boolean;

  @IsOptional()
  @IsBoolean()
  ReferralAndStaffPermissions_AllowAddReferralPanel?: boolean;

  @IsOptional()
  @IsBoolean()
  ReferralAndStaffPermissions_AllowAddInternalReferralUser?: boolean;

  @IsOptional()
  @IsBoolean()
  ReferralAndStaffPermissions_AllowAddExternalReferralUser?: boolean;

  @IsOptional()
  @IsBoolean()
  ReferralAndStaffPermissions_AllowAddDoctorName?: boolean;

  @IsOptional()
  @IsBoolean()
  ReferralAndStaffPermissions_AllowAddRadiologistName?: boolean;

  @IsOptional()
  @IsBoolean()
  ReferralAndStaffPermissions_AllowAddRadiologyTechnicianName?: boolean;

  @IsOptional()
  @IsBoolean()
  ReferralAndStaffPermissions_AllowAddPhlebotomistName?: boolean;

  // ── Billing Menu ──
  @IsOptional()
  @IsBoolean()
  BillingMenu_AllowCollectionOfAmountByOtherUser?: boolean;

  @IsOptional()
  @IsBoolean()
  BillingMenu_AllowCancellationByOtherUser?: boolean;

  @IsOptional()
  @IsBoolean()
  BillingMenu_AllowBillCopyPrintForPaidBillingsOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  BillingMenu_AllowOtherUserToEditQuotation?: boolean;

  // ── Appointment ──
  @IsOptional()
  @IsBoolean()
  Appointment_AllowCheckInForPaidAppointmentsOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  Appointment_AllowProgressOfUnpaidAndPartialPaidAppointments?: boolean;

  @IsOptional()
  @IsEnum(ExternalIdFormat)
  Appointment_AutoIncrementExternalAppointmentIdFormat?: ExternalIdFormat;

  // ── Patients / UMID ──
  @IsOptional() @IsBoolean() Patients_AllowMergingTwoPatients?: boolean;

  @IsOptional()
  @IsEnum(ExternalIdFormat)
  Patients_AutoIncrementExternalPatientIdFormat?: ExternalIdFormat;
}
