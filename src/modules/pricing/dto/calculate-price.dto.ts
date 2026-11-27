import {
  ArrayUnique,
  IsArray,
  IsBoolean,
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

  /**
   * Price lab tests at their Emergency Price (when set, > 0) instead of their
   * list price — Registration Settings → Emergency Pricing. Create Order sends
   * the state it priced with (`GET /registration-settings/emergency-pricing`,
   * or the edited order's `isEmergencyPricing`); this is a preview only — the
   * order save resolves the authoritative decision itself. Panels are
   * unaffected. Omitted/false = list prices (Quotations never send it).
   */
  @IsBoolean()
  @IsOptional()
  emergencyPricing?: boolean;

  /**
   * Update Order only: the order being edited. Together with `keptItemIds` it
   * makes the server price the order's kept lines at the price they were sold at
   * (`OrderItem.unitPrice`) instead of today's master price — but only once the
   * order is active/billed, mirroring `OrderService.update`. Omitted = every id
   * is priced from the live list (Create Order, quotations).
   */
  @IsUUID('all')
  @IsOptional()
  orderId?: string;

  /**
   * Update Order only: `OrderItem.id`s of the lines the form is keeping. Lines in
   * `labTestIds`/`labPanelIds` that belong to these items use their stored
   * price; every other id (newly added tests) uses the live price.
   */
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  keptItemIds?: string[];
}
