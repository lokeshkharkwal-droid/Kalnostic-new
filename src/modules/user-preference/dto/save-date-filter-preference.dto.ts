import { IsIn, IsISO8601, Matches, ValidateIf } from 'class-validator';
import {
  DATE_FILTER_PRESETS,
  ISO_DATE,
  type DateFilterPreset,
} from '../user-preference.constants';

/**
 * Save the caller's default date filter for one screen. `dateFrom`/`dateTo` are
 * required (and only meaningful) for `CUSTOM`; for a relative preset they are
 * ignored and stored as null.
 */
export class SaveDateFilterPreferenceDto {
  @IsIn(DATE_FILTER_PRESETS)
  preset: DateFilterPreset;

  @ValidateIf((o: SaveDateFilterPreferenceDto) => o.preset === 'CUSTOM')
  @Matches(ISO_DATE, { message: 'dateFrom must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true }, { message: 'dateFrom must be a valid date' })
  dateFrom?: string;

  @ValidateIf((o: SaveDateFilterPreferenceDto) => o.preset === 'CUSTOM')
  @Matches(ISO_DATE, { message: 'dateTo must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true }, { message: 'dateTo must be a valid date' })
  dateTo?: string;
}
