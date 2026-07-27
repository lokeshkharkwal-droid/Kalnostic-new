import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Partial update of a branch's operational settings (PUT /branches/:id/settings).
 * Only the supplied fields are changed; a missing settings row is created with
 * defaults on first write.
 */
export class UpdateBranchSettingDto {
  /**
   * When true, this branch's TAT is driven by the NABL cron stopwatch instead
   * of the accept→approve flow (see NablTatCronService). Defaults to false.
   */
  @IsBoolean()
  @IsOptional()
  isNablTatEnabled?: boolean;
}
