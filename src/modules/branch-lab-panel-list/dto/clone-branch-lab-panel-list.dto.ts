import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Clone an existing branch Lab Panel List into a new, independent list. */
export class CloneBranchLabPanelListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
