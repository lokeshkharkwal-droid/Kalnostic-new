import { IsString, Matches, MaxLength } from 'class-validator';
import { RawString } from '../../../common/decorators/raw-string.decorator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Reject Sample modal (PDF §B.11.5) — Received → Rejected. `rejectionReason` is the
 * mandatory reason dropdown (configurable in Settings). The origin branch is
 * notified; the sample is not processed.
 */
export class TransferRejectDto extends SampleNoteDto {
  /**
   * Reason for the rejection (mandatory): text with at least one visible
   * character. An empty or spaces-only value is refused with a 400, so a
   * direct API call cannot skip what the dropdown enforces. `@RawString()` keeps
   * a non-text value (object, number) from being turned into junk text first.
   */
  @RawString()
  @IsString()
  @Matches(/\S/, {
    message: 'rejectionReason must contain at least one non-space character',
  })
  @MaxLength(255)
  rejectionReason: string;
}
