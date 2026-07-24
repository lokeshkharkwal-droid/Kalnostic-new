import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TripStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for listing the active branch's trips: pagination + date range +
 * salesperson + status + free-text search (trip code / location / notes).
 */
export class ListTripsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** ISO date (yyyy-mm-dd) lower bound on trip date. */
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /** ISO date (yyyy-mm-dd) upper bound on trip date. */
  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  salespersonId?: string;

  @IsOptional()
  @IsEnum(TripStatus)
  status?: TripStatus;
}
