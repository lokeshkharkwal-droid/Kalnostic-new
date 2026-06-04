import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ChangeSiteAdminPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  newPassword: string;
}
