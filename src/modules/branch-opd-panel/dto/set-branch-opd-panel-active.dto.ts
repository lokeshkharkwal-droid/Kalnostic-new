import { IsBoolean } from 'class-validator';

/** Enable/disable a branch opd panel in the branch's Opd Panel List. */
export class SetBranchOpdPanelActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
