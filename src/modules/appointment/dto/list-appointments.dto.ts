import { AppointmentStatus, AppointmentType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the appointment listing endpoint (`GET /appointments`).
 * Extends the shared pagination DTO. `search` matches the appointment `code`
 * (case-insensitive); `status` / `appointmentType` filter by those fields. All
 * filters are scoped to the caller's tenant + active branch in the service.
 * Validated by `class-validator` only.
 */
export class ListAppointmentsDto extends PaginationQueryDto {
  /** Case-insensitive match against the appointment code (e.g. `APT-00001`). */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;

  /** Filter by current lifecycle status. */
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  /** Filter by service section. */
  @IsOptional()
  @IsEnum(AppointmentType)
  appointmentType?: AppointmentType;
}
