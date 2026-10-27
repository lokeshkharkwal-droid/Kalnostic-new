import {
  B2bClientType,
  BillingType,
  OrderStatus,
  OrderType,
  QuotationStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { roundToTwoDecimalPlacesTransform } from '../../../common/utils';
import { OrderItemDto } from './order-item.dto';
import { BillingDetailsDto } from './billing-details.dto';
import {
  OrderDiagnosticsDto,
  OrderPrescriptionAttachmentDto,
} from './order-diagnostics.dto';
import { OrderOpdDto } from './order-opd.dto';
import { OrderRadiologyDto } from './order-radiology.dto';
import { OrderPaymentDto } from './order-payment.dto';

/**
 * Manual per-sub-order paid allocation for a COMBINED (diagnostic + radiology)
 * order. When present, the collected payment is recorded as exactly these amounts
 * on the two CHILD sub-orders instead of being auto-split proportionally — the
 * operator sets it on `/registration/create` to control how a PARTIAL payment
 * lands on each sub-order. `diagnostics + radiology` must equal the total paid
 * across `payments` (enforced in `OrderService.create`). Rupees, up to 2 dp.
 */
export class SubOrderPaidSplitDto {
  /** Amount of the collected payment recorded against the diagnostic sub-order. */
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  diagnostics!: number;

  /** Amount of the collected payment recorded against the radiology sub-order. */
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  radiology!: number;
}

/**
 * Create an order. The frontend submits everything in one call: basic info, the
 * selected catalogue `items`, and the optional diagnostics/opd/radiology sections
 * plus any `payments`. `tenantId`/`branchId`/`orderCode` come from
 * context/system — never the body. All foreign refs are validated in
 * `OrderService`; the whole graph is created in one transaction.
 */
export class CreateOrderDto {
  /** Lifecycle stage; defaults to DRAFT when omitted. */
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  /**
   * Quotation lifecycle (only meaningful when `status = QUOTE`). Defaults to
   * DRAFT for a quote when omitted.
   */
  @IsOptional()
  @IsEnum(QuotationStatus)
  quotationStatus?: QuotationStatus;

  /** Quotation validity date (ISO-8601 date); used to derive EXPIRED. */
  @IsOptional()
  @IsDateString()
  quotationValidTill?: string;

  /**
   * Source quotation this order was converted from — FK to a QUOTE order in the
   * caller's tenant. When present and this order is finalized (any status other
   * than QUOTE), the service links back to it and flips that quote's
   * `quotationStatus` to CONVERTED in the same transaction. Ignored on a plain
   * quote save (`status = QUOTE`).
   */
  @IsOptional()
  @IsUUID()
  sourceQuotationId?: string;

  /**
   * User-facing external Order/Quote id — always optional and independent of the
   * internal `orderCode` (which the backend always generates). Only honoured when
   * the branch's configured external-id format is NONE (manual entry): if a value
   * is supplied it must be unique within the branch, otherwise it is left unset.
   * When a format is configured, the value is auto-generated server-side and any
   * supplied value here is ignored.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  externalOrderId?: string;

  /** Order date (ISO-8601 date). */
  @IsDateString()
  orderDate: string;

  @IsEnum(OrderType)
  orderType: OrderType;

  @IsEnum(BillingType)
  billingType: BillingType;

  @IsOptional()
  @IsBoolean()
  isUrgentBill?: boolean;

  @IsOptional()
  @IsBoolean()
  isBillGenerated?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  orderNotes?: string;

  /** Order time-of-day ("HH:mm"), separate from the DATE-only `orderDate`. */
  @IsOptional()
  @IsString()
  @MaxLength(5)
  orderTime?: string;

  /**
   * Billing-type-specific sub-form (insurance / corporate / govt-scheme / TPA).
   * Persisted as-is so the whole billing sub-section round-trips on edit.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  billingDetails?: BillingDetailsDto;

  /** The patient this order is for (required). */
  @IsUUID()
  patientId: string;

  /** Appointment date & time (ISO-8601 date-time). */
  @IsOptional()
  @IsDateString()
  appointmentAt?: string;

  /** Referring doctor — FK to a ReferralDoctor in the caller's tenant. */
  @IsOptional()
  @IsUUID()
  referredByDoctorId?: string;

  /** Referral (B2B) panel — FK to a ReferralPanel in the caller's tenant. */
  @IsOptional()
  @IsUUID()
  referralPanelId?: string;

  /** B2B client billing type. */
  @IsOptional()
  @IsEnum(B2bClientType)
  b2bClient?: B2bClientType;

  /** Internal referral — FK to an InternalReferral in the caller's tenant. */
  @IsOptional()
  @IsUUID()
  internalReferralId?: string;

  /** External referral — FK to an ExternalReferral in the caller's tenant. */
  @IsOptional()
  @IsUUID()
  externalReferralId?: string;

  /**
   * Pricing lists resolved for this order (from the referral priority, or the
   * default Walk-in list). The items' `branchLabTestId`/`branchLabPanelId` belong
   * to these lists; item unit prices are snapshotted from their `listPrice`.
   */
  @IsOptional()
  @IsUUID()
  branchLabTestListId?: string;

  @IsOptional()
  @IsUUID()
  branchLabPanelListId?: string;

  /**
   * Radiology pricing lists resolved for this order (parallel to the lab lists
   * above). The items' `branchRadiologyTestId`/`branchRadiologyPanelId` belong to
   * these lists; item unit prices are snapshotted from their `listPrice`.
   */
  @IsOptional()
  @IsUUID()
  branchRadiologyTestListId?: string;

  @IsOptional()
  @IsUUID()
  branchRadiologyPanelListId?: string;

  /** Selected catalogue entries (branch lab tests / panels / direct entries). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items?: OrderItemDto[];

  /** Diagnostics section (optional). */
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderDiagnosticsDto)
  diagnostics?: OrderDiagnosticsDto;

  /** OPD section (optional). */
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderOpdDto)
  opd?: OrderOpdDto;

  /** Radiology section (optional). */
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderRadiologyDto)
  radiology?: OrderRadiologyDto;

  /**
   * Prescription files uploaded in the Radiology section, persisted as the
   * patient's `PatientDocument`s (category DOCUMENT) — same mechanism as the
   * diagnostics prescriptions. Kept at the order level (NOT on the `radiology`
   * section) because the radiology section requires a radiologist, but a
   * prescription can be attached to a radiology order that has only items and no
   * radiologist selected.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderPrescriptionAttachmentDto)
  radiologyPrescriptionAttachments?: OrderPrescriptionAttachmentDto[];

  /** Payment ledger entries (optional). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderPaymentDto)
  payments?: OrderPaymentDto[];

  /**
   * Manual per-sub-order paid split for a COMBINED order (optional). When sent,
   * the collected payment is recorded as exactly these amounts on the diagnostic
   * and radiology sub-orders instead of being auto-split proportionally. Ignored
   * for a single-section order; the two values must sum to the total paid.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => SubOrderPaidSplitDto)
  subOrderPaidSplit?: SubOrderPaidSplitDto;

  /**
   * Amount (same integer units as the payment ledger) collected on this order
   * toward the patient's outstanding **previous dues**. Transient — used only to
   * enforce the branch's Previous-Dues rules (§Charges & Deductions) when the
   * order is finalized (`status = ORDER`); it is not persisted on the order.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  previousDuesCleared?: number;
}
