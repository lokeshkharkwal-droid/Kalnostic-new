import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';
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

  /**
   * "Send all + skip invalid" — for group-scoped actions the FE sends every
   * sample id in the group; samples not in a legal state for this action are
   * skipped server-side instead of failing the batch. Omit for strict bulk.
   */
  @IsOptional()
  @IsBoolean()
  skipInvalid?: boolean;

  /**
   * "Force" (group status actions) — apply the action to every id regardless of
   * its current status, overriding to the action's target status (no transition
   * validation). Distinct from `skipInvalid` (which skips instead of forcing).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/** Bulk Collect / Collect & Print (§A.10.1). */
export class BulkCollectDto extends CollectSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];

  /**
   * "Send all + skip invalid" — for group-scoped actions the FE sends every
   * sample id in the group; samples not in a legal state for this action are
   * skipped server-side instead of failing the batch. Omit for strict bulk.
   */
  @IsOptional()
  @IsBoolean()
  skipInvalid?: boolean;

  /**
   * "Force" (group status actions) — apply the action to every id regardless of
   * its current status, overriding to the action's target status (no transition
   * validation). Distinct from `skipInvalid` (which skips instead of forcing).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/** Bulk Accept (§A.10). */
export class BulkAcceptDto extends AcceptSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];

  /**
   * "Send all + skip invalid" — for group-scoped actions the FE sends every
   * sample id in the group; samples not in a legal state for this action are
   * skipped server-side instead of failing the batch. Omit for strict bulk.
   */
  @IsOptional()
  @IsBoolean()
  skipInvalid?: boolean;

  /**
   * "Force" (group status actions) — apply the action to every id regardless of
   * its current status, overriding to the action's target status (no transition
   * validation). Distinct from `skipInvalid` (which skips instead of forcing).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/** Bulk Store (§A.10). */
export class BulkStoreDto extends StoreSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];

  /**
   * "Send all + skip invalid" — for group-scoped actions the FE sends every
   * sample id in the group; samples not in a legal state for this action are
   * skipped server-side instead of failing the batch. Omit for strict bulk.
   */
  @IsOptional()
  @IsBoolean()
  skipInvalid?: boolean;

  /**
   * "Force" (group status actions) — apply the action to every id regardless of
   * its current status, overriding to the action's target status (no transition
   * validation). Distinct from `skipInvalid` (which skips instead of forcing).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/** Bulk Discard (§A.10). */
export class BulkDiscardDto extends DiscardSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];

  /**
   * "Send all + skip invalid" — for group-scoped actions the FE sends every
   * sample id in the group; samples not in a legal state for this action are
   * skipped server-side instead of failing the batch. Omit for strict bulk.
   */
  @IsOptional()
  @IsBoolean()
  skipInvalid?: boolean;

  /**
   * "Force" (group status actions) — apply the action to every id regardless of
   * its current status, overriding to the action's target status (no transition
   * validation). Distinct from `skipInvalid` (which skips instead of forcing).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/** Bulk Cancel (§A.10). */
export class BulkCancelDto extends CancelSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];

  /**
   * "Send all + skip invalid" — for group-scoped actions the FE sends every
   * sample id in the group; samples not in a legal state for this action are
   * skipped server-side instead of failing the batch. Omit for strict bulk.
   */
  @IsOptional()
  @IsBoolean()
  skipInvalid?: boolean;

  /**
   * "Force" (group status actions) — apply the action to every id regardless of
   * its current status, overriding to the action's target status (no transition
   * validation). Distinct from `skipInvalid` (which skips instead of forcing).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/** Bulk Repeat (§A.10). */
export class BulkRepeatDto extends RepeatSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];

  /**
   * "Send all + skip invalid" — for group-scoped actions the FE sends every
   * sample id in the group; samples not in a legal state for this action are
   * skipped server-side instead of failing the batch. Omit for strict bulk.
   */
  @IsOptional()
  @IsBoolean()
  skipInvalid?: boolean;

  /**
   * "Force" (group status actions) — apply the action to every id regardless of
   * its current status, overriding to the action's target status (no transition
   * validation). Distinct from `skipInvalid` (which skips instead of forcing).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/** Bulk Return (§A.10). */
export class BulkReturnDto extends ReturnSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];

  /**
   * "Send all + skip invalid" — for group-scoped actions the FE sends every
   * sample id in the group; samples not in a legal state for this action are
   * skipped server-side instead of failing the batch. Omit for strict bulk.
   */
  @IsOptional()
  @IsBoolean()
  skipInvalid?: boolean;

  /**
   * "Force" (group status actions) — apply the action to every id regardless of
   * its current status, overriding to the action's target status (no transition
   * validation). Distinct from `skipInvalid` (which skips instead of forcing).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
