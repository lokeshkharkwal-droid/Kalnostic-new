import {
  AppointmentStatus,
  BillingType,
  OrderStatus,
  OrderType,
  PaymentStatus,
  QuotationStatus,
} from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';
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

  /**
   * Lifecycle status of the linked appointment (the appointments list filter).
   * Matches the `Appointment.status` on orders saved with `status = APPOINTMENT`.
   */
  @IsOptional()
  @IsEnum(AppointmentStatus)
  appointmentStatus?: AppointmentStatus;

  /** Quotation lifecycle filter (EXPIRED derived from `quotationValidTill`). */
  @IsOptional()
  @IsEnum(QuotationStatus)
  quotationStatus?: QuotationStatus;

  /**
   * Payment status filter, matched against the order's stored `paymentStatus`
   * (`NOT_PAID` | `PARTIALLY_PAID` | `PAID`), which is derived from the payment
   * ledger and kept in sync on every payment write.
   */
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  /** Referring doctor filter (FK). */
  @IsOptional()
  @IsUUID()
  referredByDoctorId?: string;

  /** Referral (B2B) panel filter (FK). */
  @IsOptional()
  @IsUUID()
  referralPanelId?: string;

  /**
   * B2B filter — `true` returns only orders that have a referral panel set
   * (`referralPanelId` not null); `false` returns only orders with no referral
   * panel. Presence of a referral panel is what makes an order B2B.
   */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isB2b?: boolean;

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
  @ToBoolean()
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

  /**
   * Scope to orders carrying a given section. The order console tabs use this
   * (`DIAGNOSTICS`); an order matches when the corresponding section row exists.
   */
  @IsOptional()
  @IsIn(['DIAGNOSTICS', 'OPD', 'RADIOLOGY'])
  section?: 'DIAGNOSTICS' | 'OPD' | 'RADIOLOGY';

  /**
   * Department filter — matches orders with an item whose test/panel carries
   * this (logical) `departmentId`.
   */
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** Lab-test filter — matches orders with an item for this branch lab test. */
  @IsOptional()
  @IsUUID()
  branchLabTestId?: string;

  /** Lab-panel filter — matches orders with an item for this branch lab panel. */
  @IsOptional()
  @IsUUID()
  branchLabPanelId?: string;

  /**
   * Sample collection status, derived across the order's items from
   * `collectedAt`: `PENDING` (none collected), `COLLECTED` (all collected),
   * `PARTIAL` (some collected).
   */
  @IsOptional()
  @IsIn(['PENDING', 'PARTIAL', 'COLLECTED'])
  sampleStatus?: 'PENDING' | 'PARTIAL' | 'COLLECTED';

  /** Home-visit filter (`OrderDiagnostics.isHomeVisit`). */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isHomeVisit?: boolean;

  /**
   * Outsource filter — maps to the diagnostics sample source
   * (`true` → `SUPPLIED`, `false` → `IN_HOUSE`).
   */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isOutsource?: boolean;

  /** Urgent filter (`Order.isUrgentBill`). */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isUrgent?: boolean;
}
