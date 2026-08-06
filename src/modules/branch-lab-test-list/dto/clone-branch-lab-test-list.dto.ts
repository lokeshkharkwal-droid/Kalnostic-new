import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Clone an existing branch Lab Test List into a new, independent list. */
export class CloneBranchLabTestListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}
