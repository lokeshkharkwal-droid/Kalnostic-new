import { SettlementPartyType, SettlementStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Filters for the settlement summary-cards endpoint. Mirrors the list filters
 * (minus pagination) so the cards reconcile with the same scoped dataset the list
 * shows.
 */
export class SettlementSummaryQueryDto {
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
  @IsEnum(SettlementPartyType)
  settlementType?: SettlementPartyType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyId?: string;

  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;
}
