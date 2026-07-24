import { CollectionStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Advance-status payload (the Update Status dialog). The target `status` is
 * validated against the collection state machine server-side; `notes`,
 * `gpsLocation`, `attachmentUrl` and `sampleCondition` are recorded on the history
 * row (and `sampleCondition` on the collection when moving to `SAMPLE_COLLECTED`).
 */
export class UpdateCollectionStatusDto {
  @IsEnum(CollectionStatus)
  status: CollectionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  gpsLocation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  attachmentUrl?: string;

  /** Sample condition captured at collection (recorded when → SAMPLE_COLLECTED). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sampleCondition?: string;
}
