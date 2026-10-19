import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * One test included in a radiology panel. `radiologyTestId` references an active
 * RadiologyTest in the same master data (validated in `RadiologyPanelService`).
 * `tenantId`/`branchId`/`radiologyPanelId` come from context — never the body.
 */
export class RadiologyPanelTestDto {
  @IsUUID()
  radiologyTestId: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isRemovable?: boolean;

  /**
   * This test's discount within the panel (0-100). Checked in
   * `RadiologyPanelService` against the referenced RadiologyTest's own
   * `discountCapPct` (the live master-data value), not just this DTO's own
   * 0-100 bound.
   */
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  discountPercent?: number;
}
