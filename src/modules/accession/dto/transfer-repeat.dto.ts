import { IsString, MaxLength } from 'class-validator';
import { HasVisibleText } from '../../../common/decorators/has-visible-text.decorator';
import { RawString } from '../../../common/decorators/raw-string.decorator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Repeat Sample modal (PDF §B.11.4) — Received/Accepted → Repeat. `repeatReason`
 * is the mandatory reason dropdown (configurable in Settings). The origin branch is
 * notified to re-collect.
 */
export class TransferRepeatDto extends SampleNoteDto {
  /**
   * Reason for the repeat (mandatory): text with at least one visible
   * character. An empty, spaces-only or invisible-characters-only value is refused with a 400, so a
   * direct API call cannot skip what the dropdown enforces. `@RawString()` keeps
   * a non-text value (object, number) from being turned into junk text first.
   */
  @RawString()
  @IsString()
  @HasVisibleText()
  @MaxLength(255)
  repeatReason: string;
}
