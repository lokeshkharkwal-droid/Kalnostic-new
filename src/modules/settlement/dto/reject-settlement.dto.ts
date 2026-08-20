import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

/**
 * Reject a settlement (doc §7.2). Recorded on the approval trail; a rejected
 * settlement may be edited and resubmitted for approval.
 */
export class RejectSettlementDto {
  /** Rejection remarks (recommended so the reason is auditable). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  notes?: string;

  /** Optional URL to a supporting rejection document (file upload is deferred). */
  @IsOptional()
  @IsUrl()
  attachmentUrl?: string;
}
