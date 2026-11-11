import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { HasVisibleText } from '../../../common/decorators/has-visible-text.decorator';
import { RawString } from '../../../common/decorators/raw-string.decorator';

/** PostgreSQL text cannot hold a NUL character: it would reach the database and come back as a 500, so it is refused here with a 400. */
const NO_NUL = /^[^\u0000]*$/;
const NO_NUL_MESSAGE = '$property must not contain a NUL character';

/**
 * Body for `POST /accession/re-run-fresh` — Re-run with a fresh sample. `reportIds` are the tests to redo (the one the
 * technician clicked, plus any tests of the same group ticked in the pop-up); all of them must belong to one order.
 */
export class ReRunFreshDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  reportIds: string[];

  /**
   * Why the tube goes back for a fresh collection (mandatory; one of the branch's configured repeat reasons). It must contain a
   * character a person can SEE: a reason of only spaces or invisible characters (zero-width space ...) is refused with a 400.
   * `@RawString()` keeps the value the client sent, so an object or array is refused instead of being turned into the text
   * "[object Object]"; a NUL character is refused too.
   */
  @RawString()
  @IsString()
  @HasVisibleText()
  @MaxLength(255)
  @Matches(NO_NUL, { message: NO_NUL_MESSAGE })
  repeatReason: string;

  /** Optional note, written on the Re-run request and on the sample and report history (text only; no NUL character). */
  @IsOptional()
  @RawString()
  @IsString()
  @Matches(NO_NUL, { message: NO_NUL_MESSAGE })
  notes?: string;
}

/** Query for `GET /accession/re-run-fresh/eligibility` — the report the technician clicked. */
export class ReRunFreshEligibilityDto {
  @IsUUID()
  reportId: string;
}
