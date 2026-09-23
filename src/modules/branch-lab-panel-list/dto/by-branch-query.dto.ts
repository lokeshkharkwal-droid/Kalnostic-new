import { IsUUID } from 'class-validator';

/**
 * Query for reading a specific branch's Lab Panel Lists from a caller with no
 * active branch of their own (Business Admin). `branchId` is required here —
 * unlike the branch-admin routes, which resolve it from the JWT profile — and
 * is verified to belong to the caller's tenant before use.
 */
export class ByBranchQueryDto {
  @IsUUID()
  branchId: string;
}
