import { AppointmentStatus, AppointmentType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload to create an appointment. `tenantId`/`branchId` come from the request
 * context (never the body — CLAUDE.md §4.7); the `code` (`APT-00001`…) is
 * system-generated. Validated by `class-validator` only.
 */
export class CreateAppointmentDto {
  /** Which service section this appointment is for. */
  @IsEnum(AppointmentType)
  appointmentType: AppointmentType;

  /**
   * Initial lifecycle status. Optional — defaults to `NEW` when omitted. The
   * initial status is also written as the first `AppointmentStatusHistory` row.
   */
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  /** Optional reason/context recorded on the initial history entry. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
