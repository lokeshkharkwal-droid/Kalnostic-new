import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Clone an existing branch Radiology Test List into a new, independent list. */
export class CloneBranchRadiologyTestListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
