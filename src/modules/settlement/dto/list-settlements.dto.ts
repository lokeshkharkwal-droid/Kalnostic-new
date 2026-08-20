import { SettlementPartyType, SettlementStatus } from '@prisma/client';
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
 * Query parameters for the settlement listing endpoint. Extends the shared
 * pagination DTO. `search` matches settlement number / party name / party mobile
 * (case-insensitive). `dateFrom`/`dateTo` filter `settlementDate` inclusively. All
 * filters optional; reads are always scoped to the caller's tenant + active branch.
 */
export class ListSettlementsDto extends PaginationQueryDto {
  /** Case-insensitive match on settlement number / party name / party mobile. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /** Restrict to a specific branch (verified against the caller's tenant). */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Inclusive lower bound on `settlementDate` (ISO date/time). */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Inclusive upper bound on `settlementDate` (ISO date/time). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Filter by settlement party type. */
  @IsOptional()
  @IsEnum(SettlementPartyType)
  settlementType?: SettlementPartyType;

  /** Filter by a specific party id (Partner filter — dependent on type). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyId?: string;

  /** Filter by settlement status. */
  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;
}
