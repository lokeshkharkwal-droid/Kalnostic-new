import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

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

  /**
   * This test's discount within the panel (0-100). Must not exceed the
   * referenced LabTest's own `discountCapPct` — checked in `LabPanelService`
   * against the live master-data value, not just this DTO's own 0-100 bound.
   */
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  discountPercent?: number;
}
