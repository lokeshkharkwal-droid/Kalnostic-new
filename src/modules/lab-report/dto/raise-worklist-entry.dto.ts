import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Body for the per-test actions that raise a worklist entry (Inform Critical
 * Alert, Out of Range, Delta Check — LABORATORY.docx §5.2-5.4). Re-Run has its
 * own DTO (`RaiseReRunDto`) since its notes are optional but the action itself
 * always applies, regardless of a specific parameter.
 */
export class RaiseWorklistEntryDto {
  @IsString()
  notes: string;

  @IsOptional()
  @IsUUID()
  resultParamId?: string;
}
