import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Rename a branch Opd Panel List (name unique per branch among active lists). */
export class RenameBranchOpdPanelListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
