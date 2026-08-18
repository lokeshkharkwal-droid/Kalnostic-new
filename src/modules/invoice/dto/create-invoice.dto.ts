import { InvoicePartyType } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * Create an invoice from selected outstanding order records. The gross amount and
 * party identity are re-derived server-side from `sourceOrderIds` — no amounts are
 * accepted from the client. `partyType` is the Outstanding report panel the invoice
 * is being created from; every source order must carry that party FK.
 */
export class CreateInvoiceDto {
  /** The four invoiceable party types (from the Outstanding report panel). */
  @IsEnum(InvoicePartyType)
  partyType: InvoicePartyType;

  /** The selected outstanding order ids to consolidate into this invoice. */
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  sourceOrderIds: string[];

  /** Invoice due date (user-selected). */
  @IsDateString()
  invoiceDueDate: string;

  /** TDS due date — captured only when TDS applies. */
  @IsOptional()
  @IsDateString()
  tdsDueDate?: string;

  /**
   * Whether TDS applies. Optional override; when omitted the party master's
   * `isTdsApplicable` is used.
   */
  @IsOptional()
  @IsBoolean()
  isTdsApplicable?: boolean;

  /**
   * TDS percentage (whole number). Optional override; when omitted the party
   * master's configured `tds` is used.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  tdsPercent?: number;

  /** Optional free-text notes. */
  @IsOptional()
  @IsString()
  notes?: string;
}
