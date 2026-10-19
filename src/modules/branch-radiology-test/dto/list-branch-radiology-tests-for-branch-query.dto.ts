import { IsUUID } from 'class-validator';
import { ListBranchRadiologyTestsQueryDto } from './list-branch-radiology-tests-query.dto';

/**
 * Query for listing a specific branch's Radiology Test List rows from a caller
 * with no active branch of their own (Business Admin, viewing a branch they
 * picked). Extends the branch-admin query shape with a required `branchId`,
 * verified to belong to the caller's tenant before use.
 */
export class ListBranchRadiologyTestsForBranchQueryDto extends ListBranchRadiologyTestsQueryDto {
  @IsUUID()
  branchId: string;
}
