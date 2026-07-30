import { IsOptional, IsUUID } from 'class-validator';
import { ListScheduleQueryDto } from './list-schedule-query.dto';

/**
 * Query parameters for the tenant-wide schedule listing endpoint
 * (`GET /schedules`). Extends {@link ListScheduleQueryDto} (pagination +
 * `search` + `status`) and adds an optional `branchId` filter so the
 * Business-Admin "Schedule Plans" page can list across all branches or narrow
 * to one. All filters are scoped to the caller's tenant in the service.
 * Validated by `class-validator` only.
 */
export class ListTenantScheduleQueryDto extends ListScheduleQueryDto {
  /** Optional: restrict results to a single branch (validated as a UUID). */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
