import { IsBoolean, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * One test included in a lab panel. `labTestId` references an active LabTest in
 * the same master data (validated in `LabPanelService`). `tenantId`/`branchId`/
 * `labPanelId` come from context — never the body.
 */
export class LabPanelTestDto {
  @IsUUID()
  labTestId: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isRemovable?: boolean;
}
