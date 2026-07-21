import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { TransferDispatchDto } from './transfer-dispatch.dto';

/**
 * Outsource payload — In-House Accepted → Outsourced, creating an OUTSOURCE
 * `SampleTransfer` (PDF §A.10.17 / Part D). The destination is a third-party lab
 * (an existing `OutsourceCenter`) that does not use Kalnostic, so all further
 * status tracking is manual (`outsourceStatus`, CR-3). Validated against the
 * caller's tenant in the service.
 */
export class OutsourceSampleDto extends TransferDispatchDto {
  /** Third-party outsource center (existing `OutsourceCenter`, same tenant). */
  @IsUUID()
  outsourceCenterId: string;

  /** Optional initial manual outsource status (e.g. "Dispatched"). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  outsourceStatus?: string;
}
