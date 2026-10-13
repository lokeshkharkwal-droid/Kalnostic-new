import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for reverting a single order payment (`POST /payments/:id/revert`). Only an
 * optional free-text reason — the row + order are resolved from the path/context,
 * never the body.
 */
export class RevertPaymentDetailsDto {
  /** Optional free-text reason recorded against the reverted payment (audit). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
