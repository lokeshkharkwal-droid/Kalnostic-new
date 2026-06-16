import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Body for the multi-branch lab-item lookup (`POST /outsource-centers/branch-lab-items`).
 * Given the branches an outsource center will serve, returns each branch's active
 * lab tests and lab panels so the frontend can select which ones to assign. Each
 * branch id is validated to belong to the caller's tenant.
 */
export class BranchLabItemsQueryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  branchIds: string[];
}
