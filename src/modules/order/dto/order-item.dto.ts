import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { DiscountMode } from '@prisma/client';
import { roundToTwoDecimalPlacesTransform } from '../../../common/utils';

/**
 * One catalogue entry on an order. Exactly one of `branchLabTestId` /
 * `branchLabPanelId` / `direct` must be set — a catalogue test, a catalogue
 * panel, or a free-text direct entry (the rule is enforced in `OrderService` and
 * by a CHECK constraint in prisma/rls.sql). `orderId`/`tenantId`/`branchId` come
 * from context — never the body.
 */
export class OrderItemDto {
  /** The branch lab test this line represents (mutually exclusive with panel/direct). */
  @IsOptional()
  @IsUUID()
  branchLabTestId?: string;

  /** The branch lab panel this line represents (mutually exclusive with test/direct). */
  @IsOptional()
  @IsUUID()
  branchLabPanelId?: string;

  /**
   * A free-text catalogue entry passed directly from the frontend (mutually
   * exclusive with the test/panel refs).
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  direct?: string;

  /**
   * Per-line discount in rupees, up to 2 decimal places (0 = none). Defaults to
   * 0 when omitted. Accepts a value with more precision than currency allows
   * (e.g. from percentage math) and rounds it to the nearest paisa.
   */
  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  /**
   * How `discountValue` below is expressed — a percentage of this line's
   * price, or a direct amount. Required alongside `discountValue` if either is
   * sent (validated together in `OrderService`, since a value's valid range
   * depends on which mode it's in).
   */
  @IsOptional()
  @IsEnum(DiscountMode)
  discountMode?: DiscountMode;

  /**
   * The raw number the technician typed for the discount — 0-100 when
   * `discountMode` is PERCENT, or minor units when AMOUNT. Kept separate from
   * `discount` (the computed amount) so the input can round-trip on edit
   * instead of only recovering the resulting amount.
   */
  @IsOptional()
  @IsNumber() // may be fractional in PERCENT mode (e.g. 12.5%); kept as-is, not rounded
  @Min(0)
  @Max(100_000_00) // generous ceiling for AMOUNT mode; PERCENT's 0-100 bound is enforced in OrderService alongside the mode check
  discountValue?: number;

  /**
   * The outsource center this line is sent to, chosen per-row. Omitted/undefined
   * = processed in-house. Validated in `OrderService` to be an active center
   * configured for this line's test/panel.
   */
  @IsOptional()
  @IsUUID()
  outsourceCenterId?: string;

  /**
   * The real amount for a free-text `direct` entry line, in rupees, up to 2
   * decimal places. Ignored for a catalogue line (branchLabTestId/
   * branchLabPanelId) — that price is always resolved server-side from the
   * active pricing list's `listPrice` (see `loadItemUnitPrices`). Sending it
   * on a non-direct line is rejected in `assertItems`.
   */
  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number;
}
