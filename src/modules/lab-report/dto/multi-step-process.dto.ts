import { MultiStepProcessType, MultiStepStage } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Body for `POST /lab-reports/:id/multi-step-process` — assigns a report to a
 * multi-step laboratory process (LABORATORY.docx §5.7). Attach File is
 * omitted, matching every sibling per-test action (Lock/Delta Check/Critical
 * Alert/Out of Range/Re-Run/Schedule/Update Status) — none of them wire an
 * attachment today; see `ActionNotesDto`'s own comment (no `/attachments`
 * endpoint exists in this codebase yet).
 */
export class AssignMultiStepProcessDto {
  @IsEnum(MultiStepProcessType)
  processType: MultiStepProcessType;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** Body for `POST /lab-reports/:id/multi-step-process/advance`. */
export class AdvanceMultiStepStageDto {
  @IsEnum(MultiStepStage)
  stage: MultiStepStage;

  @IsOptional()
  @IsString()
  notes?: string;
}
