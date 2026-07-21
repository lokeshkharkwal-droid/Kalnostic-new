import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Collect Sample modal payload (PDF §A.10.1 — New → Collected). `tubeType` is
 * mandatory (the modal's required dropdown, sourced from `AccessionSetting`);
 * `collectedAt` defaults to now when omitted. Used by both `collect` and
 * `collect-print` (the latter also assigns + returns a barcode).
 */
export class CollectSampleDto extends SampleNoteDto {
  /** Tube / sample type (mandatory). Validated against the branch's configured list. */
  @IsString()
  @MaxLength(100)
  tubeType: string;

  /** Collection timestamp (ISO). Defaults to the server's current time when omitted. */
  @IsOptional()
  @IsDateString()
  collectedAt?: string;
}
