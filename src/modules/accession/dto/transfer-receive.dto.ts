import { IsString, MaxLength } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Receive Sample modal (PDF §B.11.2) — Picked Up → Received. `receiveCondition` is
 * the mandatory condition-on-receipt dropdown (configurable in Settings).
 */
export class TransferReceiveDto extends SampleNoteDto {
  /** Sample condition on receipt (mandatory). */
  @IsString()
  @MaxLength(100)
  receiveCondition: string;
}
