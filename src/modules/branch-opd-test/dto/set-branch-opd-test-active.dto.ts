import { IsBoolean } from 'class-validator';

/** Enable/disable a branch opd test in the branch's Opd Test List. */
export class SetBranchOpdTestActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
