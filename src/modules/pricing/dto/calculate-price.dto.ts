import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { roundToTwoDecimalPlacesTransform } from '../../../common/utils';

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

  /**
   * Summed per-line diagnostic discounts (rupees, up to 2 decimal places).
   * Accepts a value with more precision than currency allows (e.g. from
   * percentage math) and rounds it to the nearest paisa, matching how the
   * discount is stored when the order is created.
   */
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  orderDiscount?: number;
}
