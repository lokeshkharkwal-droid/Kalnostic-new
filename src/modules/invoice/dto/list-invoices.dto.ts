import {
  InvoiceDueStatus,
  InvoicePartyType,
  InvoicePaymentStatus,
} from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the invoice listing endpoint. Extends the shared pagination
 * DTO. `search` matches invoice number / party name / party mobile
 * (case-insensitive). `dateFrom`/`dateTo` filter `invoiceDate` inclusively. All
 * filters optional; reads are always scoped to the caller's tenant + active branch
 * (or an explicit branch the caller is permitted).
 */
export class ListInvoicesDto extends PaginationQueryDto {
  /** Case-insensitive match on invoice number / party name / party mobile. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /** Restrict to a specific branch (verified against the caller's tenant). */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Inclusive lower bound on `invoiceDate` (ISO date/time). */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Inclusive upper bound on `invoiceDate` (ISO date/time). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Filter by invoice party type. */
  @IsOptional()
  @IsEnum(InvoicePartyType)
  invoiceType?: InvoicePartyType;

  /** Filter by a specific party id. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyId?: string;

  /** Filter by payment status (Pending / Partial / Completed / Cancelled). */
  @IsOptional()
  @IsEnum(InvoicePaymentStatus)
  paymentStatus?: InvoicePaymentStatus;

  /** Filter by due status (On Time / Overdue). */
  @IsOptional()
  @IsEnum(InvoiceDueStatus)
  dueStatus?: InvoiceDueStatus;
}
