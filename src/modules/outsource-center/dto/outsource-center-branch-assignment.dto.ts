import { ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * Assigns an outsource center to one branch with the specific lab tests and lab
 * panels the outsource party may handle for that branch. `branchId` is one of the
 * few places a branch id legitimately arrives from the client — the user assigns
 * the center to branches other than their active one — so the service validates
 * each against the caller's tenant (CLAUDE.md §4.7). `labTestIds` and `labPanelIds`
 * are optional arrays (multi-select), but at least one of the two must be non-empty
 * per assigned branch; the service enforces that rule and validates every id is an
 * active test/panel on the branch.
 */
export class OutsourceCenterBranchAssignmentDto {
  @IsUUID()
  branchId: string;

  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  labTestIds?: string[];

  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  labPanelIds?: string[];
}
