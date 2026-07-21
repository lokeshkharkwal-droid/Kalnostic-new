import {
  ActionWorklistStatus,
  DeltaCheckStatus,
  WorklistStatus,
} from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

/** Body for `PATCH .../:id/status` on Critical Alert / Out of Range (New/Pending/In Progress/Completed). */
export class UpdateWorklistStatusDto {
  @IsEnum(WorklistStatus)
  status: WorklistStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** Body for `PATCH .../:id/status` on Re-Run / Schedule Test (Pending/In Progress/Completed — no New). */
export class UpdateActionWorklistStatusDto {
  @IsEnum(ActionWorklistStatus)
  status: ActionWorklistStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** Body for `PATCH /delta-checks/:id/status` — Delta Check's own vocabulary. */
export class UpdateDeltaCheckStatusDto {
  @IsEnum(DeltaCheckStatus)
  status: DeltaCheckStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}
