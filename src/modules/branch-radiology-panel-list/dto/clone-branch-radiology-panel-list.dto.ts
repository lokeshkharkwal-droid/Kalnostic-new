import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Clone an existing branch Radiology Panel List into a new, independent list. */
export class CloneBranchRadiologyPanelListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
