import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * Append a version entry to a lab test's `versionHistory`. `version` auto-
 * increments and `modifiedBy` is taken from the JWT actor — neither is accepted
 * from the client. On append, the previous open entry's `effectiveTo` is set to
 * `effectiveFrom − 1 day` (handled in `LabTestService`).
 */
export class AddLabTestVersionDto {
  /** Date (YYYY-MM-DD) the new version takes effect. */
  @IsDateString()
  effectiveFrom: string;

  /** Person id of the approving doctor (optional). */
  @IsUUID()
  @IsOptional()
  approvedBy?: string;
}
