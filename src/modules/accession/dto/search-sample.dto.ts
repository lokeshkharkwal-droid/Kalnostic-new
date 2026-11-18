import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { SearchMenu } from '../constants/sample-search-actions.constant';

/**
 * Query of the Sample Search popup (`GET /accession/sample-search`): the barcode typed or scanned
 * and the order menu the user is in. Validated by `class-validator` only.
 */
export class SearchSampleQueryDto {
  /** The barcode to find (exact match, ignoring case; surrounding spaces are removed). */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  // No control characters (NUL, tab, newline ...): a NUL cannot be stored in the database and used to cause a 500.
  // No % or \ either: they can never be part of a barcode and would act as wildcards in the database match.
  // eslint-disable-next-line no-control-regex -- control characters are exactly what this rule rejects
  @Matches(/^[^\u0000-\u001F\u007F%\\]+$/, {
    message: 'barcode must not contain control characters, % or \\',
  })
  barcode: string;

  /** The menu the search was opened from: decides which rows the barcode is looked up in. */
  @IsIn(['IN_HOUSE', 'INTERNAL', 'EXTERNAL'])
  menu: SearchMenu;
}
