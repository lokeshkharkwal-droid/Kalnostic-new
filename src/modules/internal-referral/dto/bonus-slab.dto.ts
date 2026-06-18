import { IsNumber, Max, Min } from 'class-validator';

/**
 * One incentive-bonus slab row: a monthly-business band and the bonus percentage
 * that applies within it. Used only when `isIncentiveBonusApplicable` is true; the
 * service validates `monthlyBusinessFrom <= monthlyBusinessTo` and persists the
 * rows as JSON on the internal referral.
 */
export class BonusSlabDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyBusinessFrom: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyBusinessTo: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  bonusPct: number;
}
