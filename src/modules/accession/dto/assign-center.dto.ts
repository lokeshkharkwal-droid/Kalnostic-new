import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { HasVisibleText } from '../../../common/decorators/has-visible-text.decorator';
import { RawString } from '../../../common/decorators/raw-string.decorator';
import { TransferDispatchDto } from './transfer-dispatch.dto';

/**
 * Assign Center payload (PDF §A.7) — set the destination on a transfer that was
 * created without one. The relevant destination field depends on the transfer's
 * `kind` (INTERNAL → `destinationBranchId`; OUTSOURCE → `outsourceCenterId`;
 * EXTERNAL → `externalPartnerName`); the service validates the one matching the
 * kind.
 *
 * Extends `TransferDispatchDto` (the same base the Send/Forward/Outsource DTOs
 * use) so the modal's Logistics Information (`sendDate`, `sendTime`,
 * `sampleForm`, `logisticsType`, `logisticsPerson`) plus the shared
 * `notes`/`attachmentUrl` are accepted and persisted here too — the Assign
 * Center modal carries the identical dispatch fields as the Send modal.
 */
export class AssignCenterDto extends TransferDispatchDto {
  /** Destination branch for an INTERNAL transfer (same tenant). */
  @IsOptional()
  @IsUUID()
  destinationBranchId?: string;

  /** Outsource center for an OUTSOURCE transfer (same tenant). */
  @IsOptional()
  @IsUUID()
  outsourceCenterId?: string;

  /** Partner lab name for an EXTERNAL transfer (when given: at least one visible character). */
  @IsOptional()
  @RawString()
  @IsString()
  @HasVisibleText()
  @MaxLength(200)
  externalPartnerName?: string;
}
