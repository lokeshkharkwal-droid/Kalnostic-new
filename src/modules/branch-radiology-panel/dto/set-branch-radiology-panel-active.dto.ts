import { IsBoolean } from 'class-validator';

/** Enable/disable a branch radiology panel in the branch's Radiology Panel List. */
export class SetBranchRadiologyPanelActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
