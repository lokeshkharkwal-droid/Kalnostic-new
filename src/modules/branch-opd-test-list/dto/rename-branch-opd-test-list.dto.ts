import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Rename a branch Opd Test List (name unique per branch among active lists). */
export class RenameBranchOpdTestListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
