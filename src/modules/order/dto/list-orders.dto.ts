import {
  BillingType,
  OrderStatus,
  OrderType,
  QuotationStatus,
} from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the order listing endpoint. Extends the shared pagination
 * DTO. `search` matches `orderCode` (case-insensitive). `dateFrom`/`dateTo`
 * filter `orderDate` inclusively. `patientName`/`patientMobile` are relation
 * filters against the linked patient. `quotationStatus` filters quotes
 * (`DRAFT`/`CONVERTED`/`EXPIRED`); `EXPIRED` is derived from `quotationValidTill`
 * at query time (an open DRAFT past its validity counts as expired, and is
 * excluded from `DRAFT`). All filters optional.
 */
export class ListOrdersDto extends PaginationQueryDto {
  /** Free-text match against `orderCode` (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Dedicated Quote ID match (`orderCode`, case-insensitive). Overrides `search`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  quoteId?: string;

  /** Case-insensitive match on the patient's first/middle/last name. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  patientName?: string;

  /** Case-insensitive match on the patient's mobile. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  patientMobile?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  /** Quotation lifecycle filter (EXPIRED derived from `quotationValidTill`). */
  @IsOptional()
  @IsEnum(QuotationStatus)
  quotationStatus?: QuotationStatus;

  /** Referring doctor filter (FK). */
  @IsOptional()
  @IsUUID()
  referredByDoctorId?: string;

  /** Referral (B2B) panel filter (FK). */
  @IsOptional()
  @IsUUID()
  referralPanelId?: string;

  /** Internal referral filter (FK). */
  @IsOptional()
  @IsUUID()
  internalReferralId?: string;

  /** External referral filter (FK). */
  @IsOptional()
  @IsUUID()
  externalReferralId?: string;

  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;

  @IsOptional()
  @IsEnum(BillingType)
  billingType?: BillingType;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** `isBillGenerated` filter (query strings `'true'`/`'false'` are coerced). */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isBillGenerated?: boolean;

  /** Inclusive lower bound on `orderDate` (ISO-8601 date). */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Inclusive upper bound on `orderDate` (ISO-8601 date). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
