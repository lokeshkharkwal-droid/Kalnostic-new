import { IsUUID } from 'class-validator';
import { ListBranchOpdTestsQueryDto } from './list-branch-opd-tests-query.dto';

/**
 * Query for listing a specific branch's Opd Test List rows from a caller with
 * no active branch of their own (Business Admin). Extends the branch-admin query
 * shape with a required `branchId`, verified to belong to the caller's tenant.
 */
export class ListBranchOpdTestsForBranchQueryDto extends ListBranchOpdTestsQueryDto {
  @IsUUID()
  branchId: string;
}
