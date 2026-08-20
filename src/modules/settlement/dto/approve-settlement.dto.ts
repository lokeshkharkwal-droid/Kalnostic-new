import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

/**
 * Approve a settlement (doc §7.2). Opens from the Approve/Reject popup. The
 * approver may confirm or adjust the proposed approved amount, and must document
 * the decision (notes optional per policy). Recorded on the approval trail.
 */
export class ApproveSettlementDto {
  /**
   * The confirmed approved settlement amount (whole rupees). When omitted, the
   * proposed amount set at creation (the collected/paid basis) is kept.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  approvedAmount?: number;

  /** Approval remarks. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  notes?: string;

  /** Optional URL to a supporting approval document (file upload is deferred). */
  @IsOptional()
  @IsUrl()
  attachmentUrl?: string;
}
