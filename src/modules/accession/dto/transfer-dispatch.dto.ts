import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';

/**
 * Shared dispatch fields for the Send / Forward / Outsource modals (PDF §B.9
 * "Logistics Information"). Extended by each transfer-creation DTO with its
 * destination-specific field(s). Validated by `class-validator` only.
 */
export class TransferDispatchDto extends SampleNoteDto {
  /** Dispatch date (ISO). Defaults to now when omitted. */
  @IsOptional()
  @IsDateString()
  sendDate?: string;

  /** Dispatch time of day (`HH:mm`). */
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'sendTime must be a 24h HH:mm time',
  })
  sendTime?: string;

  /** Sample form/packaging note. */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  sampleForm?: string;

  /** Logistics type (e.g. Courier, Hand Delivery — configurable). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  logisticsType?: string;

  /** Logistics person / driver. */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  logisticsPerson?: string;
}
