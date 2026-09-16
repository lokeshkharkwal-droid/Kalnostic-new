import { IsUUID } from 'class-validator';
import { ListBranchLabTestsQueryDto } from './list-branch-lab-tests-query.dto';

/**
 * Query for listing a specific branch's Lab Test List rows from a caller with
 * no active branch of their own (Business Admin, viewing a branch they
 * picked). Extends the branch-admin query shape with a required `branchId`,
 * verified to belong to the caller's tenant before use.
 */
export class ListBranchLabTestsForBranchQueryDto extends ListBranchLabTestsQueryDto {
  @IsUUID()
  branchId: string;
}
