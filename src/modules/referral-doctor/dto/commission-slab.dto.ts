import { IsNumber, Max, Min } from 'class-validator';

/**
 * One slab-based commission row: a monthly-business band and the commission
 * percentage that applies within it. Used only when `commissionType` is
 * `SLAB_BASED`; the service validates `monthlyBusinessFrom <= monthlyBusinessTo`
 * and persists the rows as JSON on the referral doctor.
 */
export class CommissionSlabDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyBusinessFrom: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyBusinessTo: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPct: number;
}
