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

/**
 * Filters for the invoice summary-cards endpoint. Mirrors the list filters (minus
 * pagination) so the cards reconcile with the same scoped dataset the list shows.
 */
export class InvoiceSummaryQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsEnum(InvoicePartyType)
  invoiceType?: InvoicePartyType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyId?: string;

  @IsOptional()
  @IsEnum(InvoicePaymentStatus)
  paymentStatus?: InvoicePaymentStatus;

  @IsOptional()
  @IsEnum(InvoiceDueStatus)
  dueStatus?: InvoiceDueStatus;
}
