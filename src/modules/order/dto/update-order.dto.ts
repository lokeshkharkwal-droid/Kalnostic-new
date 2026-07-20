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
import { BillingDetailsDto } from './billing-details.dto';
import { OrderDiagnosticsDto } from './order-diagnostics.dto';
import { OrderOpdDto } from './order-opd.dto';
import { OrderRadiologyDto } from './order-radiology.dto';
import { OrderPaymentDto } from './order-payment.dto';

/**
 * Partial update for an order. Scalar fields (incl. `status`) are patched. When
 * `items` is provided the whole set is REPLACED (old active rows soft-deleted,
 * the new set created). When a section object is provided it is upserted (created
 * if absent, else patched). When `payments` is provided the ledger is REPLACED
 * (old rows soft-deleted, the new set created) and the order's payment status is
 * recomputed. `patientId` is not editable after creation.
 */
export class UpdateOrderDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  /** Quotation lifecycle (only meaningful when `status = QUOTE`). */
  @IsOptional()
  @IsEnum(QuotationStatus)
  quotationStatus?: QuotationStatus;

  /** Quotation validity date (ISO-8601 date); used to derive EXPIRED. */
  @IsOptional()
  @IsDateString()
  quotationValidTill?: string;

  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;

  @IsOptional()
  @IsEnum(BillingType)
  billingType?: BillingType;

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

  /** Billing-type-specific sub-form; replaced wholesale when provided. */
  @IsOptional()
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  billingDetails?: BillingDetailsDto;

  @IsOptional()
  @IsDateString()
  appointmentAt?: string;

  @IsOptional()
  @IsUUID()
  referredByDoctorId?: string;

  @IsOptional()
  @IsUUID()
  referralPanelId?: string;

  @IsOptional()
  @IsEnum(B2bClientType)
  b2bClient?: B2bClientType;

  @IsOptional()
  @IsUUID()
  internalReferralId?: string;

  @IsOptional()
  @IsUUID()
  externalReferralId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items?: OrderItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderDiagnosticsDto)
  diagnostics?: OrderDiagnosticsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderOpdDto)
  opd?: OrderOpdDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderRadiologyDto)
  radiology?: OrderRadiologyDto;

  /** Payment ledger entries. When provided, the whole ledger is replaced and the
   *  order's payment status is recomputed from these rows. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderPaymentDto)
  payments?: OrderPaymentDto[];
}
