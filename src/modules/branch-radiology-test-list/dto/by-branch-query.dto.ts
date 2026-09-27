import { IsUUID } from 'class-validator';

/**
 * Query for reading a specific branch's Radiology Test Lists from a caller with no
 * active branch of their own (Business Admin). `branchId` is verified to belong to
 * the caller's tenant before use.
 */
export class ByBranchQueryDto {
  @IsUUID()
  branchId: string;
}
