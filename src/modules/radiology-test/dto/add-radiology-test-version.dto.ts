import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * Append a version entry to a radiology test's `versionHistory`. `version`
 * auto-increments and `modifiedBy` is taken from the JWT actor.
 */
export class AddRadiologyTestVersionDto {
  /** Date (YYYY-MM-DD) the new version takes effect. */
  @IsDateString()
  effectiveFrom: string;

  /** Person id of the approving doctor (optional). */
  @IsUUID()
  @IsOptional()
  approvedBy?: string;
}
