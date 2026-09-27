import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * One test included in a opd panel. `testId` references an active
 * OpdTest in the same master data (validated in `OpdPanelService`).
 * `tenantId`/`branchId`/`panelId` come from context — never the body.
 */
export class OpdPanelTestDto {
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
   * OpdTest's own `discountCapPct` — checked in `OpdPanelService`.
   */
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  discountPercent?: number;
}
