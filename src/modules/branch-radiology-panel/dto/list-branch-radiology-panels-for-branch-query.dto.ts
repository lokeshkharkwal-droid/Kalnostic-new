import { IsUUID } from 'class-validator';
import { ListBranchRadiologyPanelsQueryDto } from './list-branch-radiology-panels-query.dto';

/**
 * Query for listing a specific branch's Radiology Panel List rows from a caller with
 * no active branch of their own (Business Admin). Extends the branch-admin query
 * shape with a required `branchId`, verified to belong to the caller's tenant.
 */
export class ListBranchRadiologyPanelsForBranchQueryDto extends ListBranchRadiologyPanelsQueryDto {
  @IsUUID()
  branchId: string;
}
