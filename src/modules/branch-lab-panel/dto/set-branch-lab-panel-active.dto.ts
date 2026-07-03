import { IsBoolean } from 'class-validator';

/** Enable/disable a branch lab panel in the branch's Lab Panel List. */
export class SetBranchLabPanelActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
