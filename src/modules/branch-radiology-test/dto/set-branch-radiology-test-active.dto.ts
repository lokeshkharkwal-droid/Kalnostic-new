import { IsBoolean } from 'class-validator';

/** Enable/disable a branch radiology test in the branch's Radiology Test List. */
export class SetBranchRadiologyTestActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
