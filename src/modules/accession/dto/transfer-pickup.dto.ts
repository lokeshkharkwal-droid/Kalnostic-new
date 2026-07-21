import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/** Picked Up Sample modal (PDF §B.11.1) — In-Transit → Picked Up. */
export class TransferPickUpDto extends SampleNoteDto {
  /** Logistics driver/person who picked the sample up (optional). */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  pickedUpBy?: string;
}
