import {
  B2bClientType,
  BillingType,
  OrderStatus,
  OrderType,
  QuotationStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderItemDto } from './order-item.dto';
import { BillingDetailsDto } from './billing-details.dto';
import { OrderDiagnosticsDto } from './order-diagnostics.dto';
import { OrderOpdDto } from './order-opd.dto';
import { OrderRadiologyDto } from './order-radiology.dto';
import { OrderPaymentDto } from './order-payment.dto';

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

  /** Payment ledger entries (optional). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderPaymentDto)
  payments?: OrderPaymentDto[];

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
