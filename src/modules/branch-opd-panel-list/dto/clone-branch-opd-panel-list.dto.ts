import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Clone an existing branch Opd Panel List into a new, independent list. */
export class CloneBranchOpdPanelListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
