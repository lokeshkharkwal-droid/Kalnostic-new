import { IsInt, IsOptional, IsString, IsUrl, Min } from 'class-validator';

/**
 * Edit a settlement (doc §7.3). Only permitted fields. Changing the approved
 * amount while the settlement is already APPROVED/PARTIALLY_SETTLED resets it to
 * PENDING_APPROVAL (re-approval rule) — the service enforces this and blocks
 * reducing the approved amount below the amount already settled. All edits audited.
 */
export class UpdateSettlementDto {
  /** Adjusted approved amount (whole rupees). Triggers re-approval when changed. */
  @IsOptional()
  @IsInt()
  @Min(1)
  approvedAmount?: number;

  /** Adjusted free-text notes. */
  @IsOptional()
  @IsString()
  notes?: string;

  /** Adjusted supporting-document URL. */
  @IsOptional()
  @IsUrl()
  attachmentUrl?: string;
}
