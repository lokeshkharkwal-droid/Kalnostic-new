import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TransferDispatchDto } from './transfer-dispatch.dto';

/**
 * Forward (External Transfer) payload — In-House Accepted → Forward (External),
 * creating an EXTERNAL `SampleTransfer` at `IN_TRANSIT` (PDF §A.9 / Part C). The
 * destination is a Kalnostic-registered partner lab (a different tenant); Phase 3
 * builds the sending side only (cross-tenant sync is an open decision). The partner
 * is captured as a name/reference on the transfer.
 */
export class ForwardSampleDto extends TransferDispatchDto {
  /** Partner lab name (e.g. "Pathkind - Gurgaon"). */
  @IsString()
  @MaxLength(200)
  externalPartnerName: string;

  /** Optional partner reference/id (free text until cross-tenant sync is built). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalPartnerRef?: string;
}
