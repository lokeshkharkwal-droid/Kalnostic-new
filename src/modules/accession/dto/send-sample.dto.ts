import { IsOptional, IsUUID } from 'class-validator';
import { TransferDispatchDto } from './transfer-dispatch.dto';

/**
 * Send (Internal Transfer) payload — In-House Accepted → Sent (Internal), creating
 * an INTERNAL `SampleTransfer` at `IN_TRANSIT` (PDF §A.9 / Part B). The destination
 * is another branch in the same tenant; it may be omitted ("Assign Center" later,
 * PDF §A.7) and set via the assign-center endpoint. Validated against the caller's
 * tenant in the service.
 */
export class SendSampleDto extends TransferDispatchDto {
  /** Destination branch (same tenant). Optional — assign later if omitted. */
  @IsOptional()
  @IsUUID()
  destinationBranchId?: string;
}
