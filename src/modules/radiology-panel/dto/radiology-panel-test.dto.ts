import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * One test included in a radiology panel. `testId` references an active
 * RadiologyTest in the same master data (validated in `RadiologyPanelService`).
 * `tenantId`/`branchId`/`panelId` come from context — never the body.
 */
export class RadiologyPanelTestDto {
  @IsUUID()
  testId: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isRemovable?: boolean;

  /**
   * This test's discount within the panel (0-100). Must not exceed the referenced
   * RadiologyTest's own `discountCapPct` — checked in `RadiologyPanelService`.
   */
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  discountPercent?: number;
}
