import {
  AlertReviewStatus,
  ReRunStatus,
  ScheduledTestStatus,
} from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

/** Body for `PATCH /re-run-requests/:id/status` — Pending/In Progress/Completed/Cancelled. */
export class UpdateReRunStatusDto {
  @IsEnum(ReRunStatus)
  status: ReRunStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Body for `PATCH .../:id/status` on the three review worklists — Critical
 * Alert, Out of Range, and Delta Check — which share one vocabulary
 * (`AlertReviewStatus`). `@IsEnum` rejects any value outside this list, so a
 * Re-Run or Schedule Test status cannot be set on these endpoints (and vice
 * versa).
 */
export class UpdateAlertReviewStatusDto {
  @IsEnum(AlertReviewStatus)
  status: AlertReviewStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** Body for `PATCH /scheduled-tests/:id/status` — Scheduled/In Progress/Rescheduled/Completed. */
export class UpdateScheduledTestStatusDto {
  @IsEnum(ScheduledTestStatus)
  status: ScheduledTestStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}
