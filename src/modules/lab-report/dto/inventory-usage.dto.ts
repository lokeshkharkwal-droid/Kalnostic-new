import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * One material-usage row on a `LabReport` (LABORATORY.docx §5.9 Generate
 * Inventory — manual entry only; no inventory master/catalogue exists in
 * this codebase to auto-attach materials configured on a test, so every row
 * here is technician-entered, matching the "Add Material Row" flow).
 * PU = Product Unit, BU = Base Unit, per the doc's own column headers.
 */
export class CreateInventoryUsageDto {
  @IsString()
  inventoryItemId: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  allocatedPu?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  allocatedBu?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  reRunPu?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  reRunBu?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  wastagePu?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  wastageBu?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

/** Body for `PATCH /lab-reports/:id/inventory/:usageId` — every field optional. */
export class UpdateInventoryUsageDto {
  @IsOptional()
  @IsString()
  inventoryItemId?: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  allocatedPu?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  allocatedBu?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  reRunPu?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  reRunBu?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  wastagePu?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  wastageBu?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}
