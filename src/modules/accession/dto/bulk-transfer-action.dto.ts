import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { SampleNoteDto } from './sample-note.dto';
import { SendSampleDto } from './send-sample.dto';
import { ForwardSampleDto } from './forward-sample.dto';
import { OutsourceSampleDto } from './outsource-sample.dto';
import { TransferPickUpDto } from './transfer-pickup.dto';
import { TransferReceiveDto } from './transfer-receive.dto';
import { TransferRepeatDto } from './transfer-repeat.dto';
import { TransferRejectDto } from './transfer-reject.dto';

/**
 * Bulk (multi-select) transfer payloads (PDF §B.12). Sending-side variants
 * (`send`/`forward`/`outsource`) carry the target **sample** ids; receiving-side
 * variants (`pick-up`/`receive`/`accept`/`repeat`/`reject`) carry the target
 * **transfer** ids. The `ids` validation is repeated on each class (class-validator
 * does not compose mixins cleanly). Up to 500 per request.
 */

/** Bulk Send (sample ids). */
export class BulkSendDto extends SendSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Forward (sample ids). */
export class BulkForwardDto extends ForwardSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Outsource (sample ids). */
export class BulkOutsourceDto extends OutsourceSampleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Picked Up (transfer ids). */
export class BulkPickUpDto extends TransferPickUpDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Receive (transfer ids). */
export class BulkReceiveDto extends TransferReceiveDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Accept (transfer ids). */
export class BulkTransferAcceptDto extends SampleNoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Repeat (transfer ids). */
export class BulkTransferRepeatDto extends TransferRepeatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Bulk Reject (transfer ids). */
export class BulkTransferRejectDto extends TransferRejectDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}
