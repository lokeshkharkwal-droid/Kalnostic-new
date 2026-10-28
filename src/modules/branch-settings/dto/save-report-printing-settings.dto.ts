import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Body of `PUT /branch-settings/report-printing`. A switch that is left out keeps
 * its current value. Tenant and branch come from the token, never from the body.
 */
export class SaveReportPrintingSettingsDto {
  /** Technician may choose which Notes sections print for a single lab test. */
  @IsOptional()
  @IsBoolean()
  isLabTestNotesSelectable?: boolean;

  /** Same, for a test that belongs to a lab panel. */
  @IsOptional()
  @IsBoolean()
  isLabPanelNotesSelectable?: boolean;
}
