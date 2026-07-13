import {
  B2bClientType,
  BillingType,
  OrderStatus,
  OrderType,
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

/**
 * Partial update for an order. Scalar fields (incl. `status`) are patched. When
 * `items` is provided the whole set is REPLACED (old active rows soft-deleted,
 * the new set created). When a section object is provided it is upserted (created
 * if absent, else patched). Payments are managed via the payment-details module,
 * not here. `patientId` is not editable after creation.
 */
export class UpdateOrderDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

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
}
