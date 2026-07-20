import { AppointmentStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload to transition an appointment to a new status. Applying it updates the
 * appointment's current `status` AND appends a row to
 * `AppointmentStatusHistory`, both in one transaction (see AppointmentService).
 * The acting person (`changedBy`/`updatedBy`) comes from the JWT, not the body.
 */
export class UpdateAppointmentStatusDto {
  /** The status to move the appointment into. */
  @IsEnum(AppointmentStatus)
  status: AppointmentStatus;

  /** Optional reason/context recorded on the history entry for this change. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
