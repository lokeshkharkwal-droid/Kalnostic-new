import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

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
   * The outsource center this line is sent to, chosen per-row. Omitted/undefined
   * = processed in-house. Validated in `OrderService` to be an active center
   * configured for this line's test/panel.
   */
  @IsOptional()
  @IsUUID()
  outsourceCenterId?: string;
}
