import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Rename a branch Radiology Test List (name unique per branch among active lists). */
export class RenameBranchRadiologyTestListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
