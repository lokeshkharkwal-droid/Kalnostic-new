import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Return Sample modal payload (PDF §A.10 — Accepted/Error/Stored → Returned).
 * Records the person the sample was handed over to (stored as the sample's
 * `logisticsPerson`).
 */
export class ReturnSampleDto extends SampleNoteDto {
  /** Person the sample was handed back to (field/patient/collector). */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  handoverPerson?: string;
}
