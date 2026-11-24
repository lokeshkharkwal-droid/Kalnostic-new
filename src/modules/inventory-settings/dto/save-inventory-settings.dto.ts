import { InventoryManualAdjustmentMode } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

/**
 * Body of `PUT /inventory-settings`. Both fields are optional so the frontend can
 * patch one part or submit the whole form; a field left out keeps its current
 * value. Tenant comes from the token, never from the body.
 */
export class SaveInventorySettingsDto {
  /** Turn automatic order-time inventory deduction on/off. */
  @IsOptional()
  @IsBoolean()
  isAutomaticInventoryReductionEnabled?: boolean;

  /** Where manual inventory adjustment is offered (order-level vs test-level). */
  @IsOptional()
  @IsEnum(InventoryManualAdjustmentMode)
  manualAdjustmentMode?: InventoryManualAdjustmentMode;
}
