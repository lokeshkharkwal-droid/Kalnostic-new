import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { RawBoolean } from '../../../common/decorators/raw-boolean.decorator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Set the "recoverable" flag of Discarded samples (Sample Search popup). Applies to
 * every id inside one transaction; only a Discarded sample can carry the flag.
 */
export class BulkSetRecoverableDto extends SampleNoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];

  /** The new value of the flag. */
  @RawBoolean()
  @IsBoolean()
  isRecoverable: boolean;

  /**
   * "Skip invalid" (the Sample Search popup sends it): a sample that is no longer Discarded (someone else just changed it) or
   * whose order is cancelled is skipped and named in the result instead of failing the whole batch. A sample that
   * already has the value is never an error. Omit for the strict all-or-nothing call.
   */
  @IsOptional()
  @RawBoolean()
  @IsBoolean()
  skipInvalid?: boolean;
}

/**
 * Confirm that Returned samples are physically back and checked (Sample Search popup). Applies
 * to every id inside one transaction; only a Returned sample can be verified.
 */
export class BulkMarkReturnedVerifiedDto extends SampleNoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];

  /**
   * "Skip invalid" (the Sample Search popup sends it): a sample that is no longer Returned, is already verified (someone
   * else just did it) or whose order is cancelled is skipped and named in the result instead of failing the whole batch.
   * Omit for the strict all-or-nothing call.
   */
  @IsOptional()
  @RawBoolean()
  @IsBoolean()
  skipInvalid?: boolean;
}
