import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';
import { CollectSampleDto } from './collect-sample.dto';
import { AcceptSampleDto } from './accept-sample.dto';
import { StoreSampleDto } from './store-sample.dto';
import { DiscardSampleDto } from './discard-sample.dto';
import { CancelSampleDto } from './cancel-sample.dto';
import { RepeatSampleDto } from './repeat-sample.dto';
import { ReturnSampleDto } from './return-sample.dto';

/**
 * Bulk (multi-select) action payloads (PDF §A.11). Each mirrors its single-item
 * DTO and adds the `ids` of the target samples; the service applies the same
 * transition to every id inside one transaction. The shared `ids` validation is
 * declared on each class (class-validator does not compose mixins cleanly). Up to
 * 500 samples per request.
 */

/** Bulk note-only action (acquire / halt / error / hold / retrieve). */
export class BulkSampleNoteDto extends SampleNoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Collect / Collect & Print (§A.10.1). */
export class BulkCollectDto extends CollectSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Accept (§A.10). */
export class BulkAcceptDto extends AcceptSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Store (§A.10). */
export class BulkStoreDto extends StoreSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Discard (§A.10). */
export class BulkDiscardDto extends DiscardSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Cancel (§A.10). */
export class BulkCancelDto extends CancelSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Repeat (§A.10). */
export class BulkRepeatDto extends RepeatSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Return (§A.10). */
export class BulkReturnDto extends ReturnSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}
