import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Body for `POST /orders/:id/collect-group` — the group-wise counterpart of the
 * per-item collect. `sampleIds` is a group's flat accession-sample id set (from
 * the Product Overview modal's grouped Test Details, mirroring the in-house
 * orders grouping); every collectable sample in the set is transitioned to
 * COLLECTED in one transaction. `print` mirrors "Collect & Print" — also assign a
 * barcode to any sample that lacks one.
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
}
