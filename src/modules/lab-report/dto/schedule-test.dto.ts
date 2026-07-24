import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Body for `POST /lab-reports/:id/schedule` and `PATCH /scheduled-tests/:id`
 * (Reschedule, LABORATORY.docx §5.6) — same fields serve both create and
 * reschedule per the spec ("the same modal serves rescheduling").
 */
export class ScheduleTestDto {
  @IsDateString()
  scheduledAt: string;

  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @IsOptional()
  @IsDateString()
  dispatchAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
