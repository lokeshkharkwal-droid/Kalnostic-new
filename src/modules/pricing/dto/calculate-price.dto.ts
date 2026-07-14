import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * Body for the Create-Order price preview (`POST /pricing/calculate`). Amounts
 * are integer **minor units** (e.g. paise), matching the `Int` price columns on
 * BranchLabTest / BranchLabPanel. `labTestIds` / `labPanelIds` are branch lab
 * test / panel ids selected on the form; charges and `orderDiscount` (the summed
 * per-line diagnostic discounts) are entered on the form. The tenant + active
 * branch come from the JWT (never the body).
 */
export class CalculatePriceDto {
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  labTestIds?: string[];

  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  labPanelIds?: string[];

  @IsInt()
  @Min(0)
  @IsOptional()
  visitingCharges?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  sampleCollectionCharges?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  orderDiscount?: number;
}
