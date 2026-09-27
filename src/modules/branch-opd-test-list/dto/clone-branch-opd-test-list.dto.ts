import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Clone an existing branch Opd Test List into a new, independent list. */
export class CloneBranchOpdTestListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
