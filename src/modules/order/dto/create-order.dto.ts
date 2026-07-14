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
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { OrderItemDto } from './order-item.dto';
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
}
