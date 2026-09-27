import { IsUUID } from 'class-validator';
import { ListBranchOpdPanelsQueryDto } from './list-branch-opd-panels-query.dto';

/**
 * Query for listing a specific branch's Opd Panel List rows from a caller with
 * no active branch of their own (Business Admin). Extends the branch-admin query
 * shape with a required `branchId`, verified to belong to the caller's tenant.
 */
export class ListBranchOpdPanelsForBranchQueryDto extends ListBranchOpdPanelsQueryDto {
  @IsUUID()
  branchId: string;
}
