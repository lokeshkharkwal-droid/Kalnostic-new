import { IsString, MaxLength } from 'class-validator';
import { HasVisibleText } from '../../../common/decorators/has-visible-text.decorator';
import { RawString } from '../../../common/decorators/raw-string.decorator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Receive Sample modal (PDF §B.11.2) — Picked Up → Received. `receiveCondition` is
 * the mandatory condition-on-receipt dropdown (configurable in Settings).
 */
export class TransferReceiveDto extends SampleNoteDto {
  /**
   * Sample condition on receipt (mandatory): text with at least one visible
   * character. An empty, spaces-only or invisible-characters-only value is refused with a 400, so a direct API
   * call cannot skip what the dropdown enforces. `@RawString()` keeps a non-text
   * value (object, number) from being turned into junk text first.
   */
  @RawString()
  @IsString()
  @HasVisibleText()
  @MaxLength(100)
  receiveCondition: string;
}
