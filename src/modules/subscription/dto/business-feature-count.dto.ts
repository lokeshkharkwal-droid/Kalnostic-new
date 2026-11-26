import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

/**
 * Body for the ad-hoc `POST /subscription/api/business-feature-count` endpoint
 * (ports EzHealthTrack `ApiController::actionBusinessFeatureCount`). Lets the
 * subscription service request an arbitrary period + feature subset and get the
 * computed counts back in the response.
 *
 * `snake_case` fields match the legacy contract. When `bill_features` is omitted
 * the full daily + monthly catalogue is computed; when the period bounds are
 * omitted the service falls back to the current day.
 */
export class BusinessFeatureCountDto {
  /** The integer business id the subscription service keys the client by. */
  @IsString()
  @Matches(/^\d+$/, { message: 'business_id must be a positive integer' })
  business_id: string;

  /** Inclusive period start (`YYYY-MM-DD` or `YYYY-MM-DD HH:mm:ss`). */
  @IsOptional()
  @IsString()
  bill_period_from?: string;

  /** Inclusive period end (`YYYY-MM-DD` or `YYYY-MM-DD HH:mm:ss`). */
  @IsOptional()
  @IsString()
  bill_period_to?: string;

  /** The feature codes to compute (defaults to the full catalogue when empty). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  bill_features?: string[];
}
