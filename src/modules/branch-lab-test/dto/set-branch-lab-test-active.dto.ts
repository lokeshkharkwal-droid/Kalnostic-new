import { IsBoolean } from 'class-validator';

/** Enable/disable a branch lab test in the branch's Lab Test List. */
export class SetBranchLabTestActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
