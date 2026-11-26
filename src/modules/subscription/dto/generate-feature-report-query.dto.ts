import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import {
  REPORT_CONTEXTS,
  type ReportContext,
} from '../business-feature.constants';

/**
 * Query string the subscription scheduler sends to
 * `GET /subscription/api/generate-business-feature-report`.
 *
 * Field names are `snake_case` to match the legacy EzHealthTrack contract the
 * scheduler already speaks (the same convention the subscription client's
 * write payloads use), so the scheduler needs no change to call Kalnostics.
 */
export class GenerateFeatureReportQueryDto {
  /** The integer business id the subscription service keys the client by. */
  @IsString()
  @Matches(/^\d+$/, { message: 'business_id must be a positive integer' })
  business_id: string;

  /**
   * Which window to report: `yesterday`/`today` → the daily feature set for that
   * day; `monthly` → the monthly feature set for the current calendar month.
   * Defaults to `yesterday` (the legacy default) when omitted.
   */
  @IsOptional()
  @IsIn(REPORT_CONTEXTS)
  report_context?: ReportContext;
}
