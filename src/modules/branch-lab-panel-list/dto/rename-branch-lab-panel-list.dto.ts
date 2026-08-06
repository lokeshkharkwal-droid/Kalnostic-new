import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Rename a branch Lab Panel List (name unique per branch among active lists). */
export class RenameBranchLabPanelListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
