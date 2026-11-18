import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { RawBoolean } from '../../../common/decorators/raw-boolean.decorator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Discard Sample modal payload (PDF §A.10 — Stored → Discarded). `discardMethod`
 * is mandatory (recorded as the history reason; validated against the branch's
 * configured discard methods). `isRecoverable` says whether the physical sample
 * can still be recovered: a later Retrieve out of Discarded is refused unless it
 * is true (omitted = not recoverable).
 */
export class DiscardSampleDto extends SampleNoteDto {
  /** Discard method (mandatory), e.g. "Biohazard Bag". */
  @IsString()
  @MaxLength(100)
  discardMethod: string;

  /** Whether the discarded sample can still be recovered (default false). */
  @IsOptional()
  @RawBoolean()
  @IsBoolean()
  isRecoverable?: boolean;
}
