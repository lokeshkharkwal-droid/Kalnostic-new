import { IsString, MaxLength } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Store Sample modal payload (PDF §A.10 — Accepted → Stored). `storeLocation` is
 * mandatory (freezer/rack location recorded on the sample).
 */
export class StoreSampleDto extends SampleNoteDto {
  /** Storage location (mandatory), e.g. "Freezer 2 / Rack B / Slot 14". */
  @IsString()
  @MaxLength(255)
  storeLocation: string;
}
