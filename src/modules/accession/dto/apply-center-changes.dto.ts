import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { HasVisibleText } from '../../../common/decorators/has-visible-text.decorator';
import { RawString } from '../../../common/decorators/raw-string.decorator';
import { TransferDispatchDto } from './transfer-dispatch.dto';

/** One tube's new center: the transfer to change and where it should go. */
export class CenterChangeItemDto {
  @IsUUID()
  transferId!: string;

  /** New destination branch for an INTERNAL transfer (same tenant). */
  @IsOptional()
  @IsUUID()
  destinationBranchId?: string;

  /**
   * The destination the dialog was showing for this tube (`null` = none yet). When
   * given, the change is refused (422 `TRANSFER_CENTER_CHANGED`) if the tube's center
   * is no longer that, so a stale dialog cannot overwrite someone else's change.
   * Omitted = no such check (older callers).
   */
  @IsOptional()
  @IsUUID()
  expectedDestinationBranchId?: string | null;

  /** New outsource center for an OUTSOURCE transfer (same tenant). */
  @IsOptional()
  @IsUUID()
  outsourceCenterId?: string;

  /** New partner lab name for an EXTERNAL transfer. */
  @IsOptional()
  @RawString()
  @IsString()
  @HasVisibleText()
  @MaxLength(200)
  externalPartnerName?: string;
}

/**
 * The Assign / Edit Center dialog's Confirm, as ONE all-or-nothing request: the
 * ticked tubes each get their own center (`changes`), the un-ticked tubes are
 * retrieved (`retrieveSampleIds`), and the logistics fields (date, time, logistics
 * type / person, sample form, notes, attachment - inherited from
 * {@link TransferDispatchDto}) are shared by every changed tube. If any tube cannot be
 * done, nothing at all is changed and the error names that tube.
 */
export class ApplyCenterChangesDto extends TransferDispatchDto {
  /** Per-tube center changes (may be empty when the user only un-ticked tubes). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CenterChangeItemDto)
  changes?: CenterChangeItemDto[];

  /** Samples to retrieve (un-ticked tubes still In-Transit / Picked Up). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  retrieveSampleIds?: string[];
}
