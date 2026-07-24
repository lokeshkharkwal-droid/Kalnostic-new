import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Reschedule payload (the Reschedule dialog). Moves the visit to a new
 * `collectionAt`, optionally reassigning the phlebotomist. The service releases the
 * old phlebotomist slot and reserves the new one atomically (throwing SlotFull /
 * DailyCapReached / SlotUnavailable if the new time can't be booked), updates the
 * order's diagnostics + appointment time, and moves the collection to `RESCHEDULED`.
 */
export class RescheduleCollectionDto {
  /** New collection date/time (ISO-8601). */
  @IsDateString()
  collectionAt: string;

  /** New phlebotomist (a staff Person id). Omit to keep the current one. */
  @IsOptional()
  @IsUUID()
  phlebotomistId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  attachmentUrl?: string;
}
