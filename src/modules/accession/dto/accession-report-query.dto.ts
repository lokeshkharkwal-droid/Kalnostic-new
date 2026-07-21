import { SampleStatus } from '@prisma/client';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { REPORT_STATUSES } from '../constants/report-statuses.constant';

/**
 * Query for an Accession Report sub-tab (`GET /accession/reports`). `type` selects
 * the exception category (§F.2) — one of the six report statuses. Scoped to the
 * caller's tenant + active branch in the service.
 */
export class AccessionReportQueryDto extends PaginationQueryDto {
  /** Exception category to list (Error/Halt/Hold/Repeat/Cancelled/Returned). */
  @IsIn(REPORT_STATUSES as SampleStatus[])
  type: SampleStatus;

  /** Case-insensitive match against the accession number or barcode. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;

  /** Order-date range start (ISO). */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Order-date range end (ISO). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
