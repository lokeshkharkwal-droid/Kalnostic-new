import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Assign Center payload (PDF §A.7) — set the destination on a transfer that was
 * created without one. The relevant field depends on the transfer's `kind`
 * (INTERNAL → `destinationBranchId`; OUTSOURCE → `outsourceCenterId`; EXTERNAL →
 * `externalPartnerName`); the service validates the one matching the kind.
 */
export class AssignCenterDto {
  /** Destination branch for an INTERNAL transfer (same tenant). */
  @IsOptional()
  @IsUUID()
  destinationBranchId?: string;

  /** Outsource center for an OUTSOURCE transfer (same tenant). */
  @IsOptional()
  @IsUUID()
  outsourceCenterId?: string;

  /** Partner lab name for an EXTERNAL transfer. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalPartnerName?: string;
}
