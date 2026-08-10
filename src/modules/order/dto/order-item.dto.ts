import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DiscountMode } from '@prisma/client';

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

  /** Per-line discount in minor units (0 = none). Defaults to 0 when omitted. */
  @IsOptional()
  @IsInt()
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
  @IsInt()
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
}
