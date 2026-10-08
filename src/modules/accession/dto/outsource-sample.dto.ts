import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { TransferDispatchDto } from './transfer-dispatch.dto';

/**
 * Outsource payload — In-House Accepted → Outsourced, creating an OUTSOURCE
 * `SampleTransfer` (PDF §A.10.17 / Part D). The destination is a third-party lab
 * (an existing `OutsourceCenter`) that does not use Kalnostic, so all further
 * status tracking is manual (`outsourceStatus`, CR-3). Validated against the
 * caller's tenant in the service.
 *
 * The center is **optional at this step**: a sample may be marked Outsourced now
 * and have its center assigned later via the Assign Center action
 * (`POST transfers/:id/assign-center`), mirroring the Internal Send flow whose
 * station is likewise optional-then-assignable. When supplied it is validated
 * against the caller's tenant; when omitted the transfer is created with a null
 * `outsourceCenterId`.
 */
export class OutsourceSampleDto extends TransferDispatchDto {
  /**
   * Third-party outsource center (existing `OutsourceCenter`, same tenant).
   * Optional — assign later via Assign Center.
   */
  @IsOptional()
  @IsUUID()
  outsourceCenterId?: string;

  /** Optional initial manual outsource status (e.g. "Dispatched"). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  outsourceStatus?: string;
}
