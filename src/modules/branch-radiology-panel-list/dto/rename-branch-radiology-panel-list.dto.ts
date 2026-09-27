import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Rename a branch Radiology Panel List (name unique per branch among active lists). */
export class RenameBranchRadiologyPanelListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
