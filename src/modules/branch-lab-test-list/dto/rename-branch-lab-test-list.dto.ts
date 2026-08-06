import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Rename a branch Lab Test List (name unique per branch among active lists). */
export class RenameBranchLabTestListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
