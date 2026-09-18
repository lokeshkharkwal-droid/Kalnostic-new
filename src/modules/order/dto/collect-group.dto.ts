import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Body for `POST /orders/:id/collect-group` — the group-wise counterpart of the
 * per-item collect. `sampleIds` is a group's flat accession-sample id set (from
 * the Product Overview modal's grouped Test Details, mirroring the in-house
 * orders grouping); every collectable sample in the set is transitioned to
 * COLLECTED in one transaction. `print` mirrors "Collect & Print" — also assign a
 * barcode to any sample that lacks one. `tubeType`/`notes`/`attachmentUrl` carry
 * the Collect (& Print) modal's inputs so the Overview modal reaches full parity
 * with the accession "Collect & Print" action.
 */
export class CollectGroupDto {
  /** The group's accession sample ids to collect. */
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(4, { each: true })
  sampleIds!: string[];

  /** When true, also assign a barcode to the collected sample(s). */
  @IsOptional()
  @IsBoolean()
  print?: boolean;

  /**
   * Tube / sample type chosen in the Collect modal. When set it is written to
   * every collected sample; otherwise the server derives it from the sample's
   * container/sample type (unchanged behaviour).
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tubeType?: string;

  /** Optional collection note, recorded on each sample's status history. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** Optional attachment URL, recorded on each sample's status history. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  attachmentUrl?: string;
}
