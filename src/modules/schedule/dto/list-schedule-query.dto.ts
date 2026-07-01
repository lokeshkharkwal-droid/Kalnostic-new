import { ScheduleStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the schedule listing endpoint
 * (`GET /branches/:branchId/schedules`). Extends the shared pagination DTO.
 * `search` matches the schedule `planName` (case-insensitive); `status` filters
 * by lifecycle state. Both filters are scoped to the caller's tenant + branch in
 * the service. Validated by `class-validator` only.
 */
export class ListScheduleQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against the schedule plan name. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Filter by lifecycle status (ACTIVE / INACTIVE / DRAFT). */
  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;
}
