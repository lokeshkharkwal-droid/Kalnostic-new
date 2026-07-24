import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Filters shared by the dashboard summary and the phlebotomist-wise report. All
 * optional; `dateFrom`/`dateTo` bound `scheduledCollectionAt` inclusively.
 */
export class CollectionSummaryQueryDto {
  /** Inclusive lower bound on `scheduledCollectionAt` (ISO-8601 date). */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Inclusive upper bound on `scheduledCollectionAt` (ISO-8601 date). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Restrict the rollup to a single phlebotomist (a staff Person id). */
  @IsOptional()
  @IsUUID()
  phlebotomistId?: string;

  /** Collection type (accepted for forward-compat; does not narrow results). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  collectionType?: string;

  /** Branch override (defaults to the active branch from the JWT). */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
