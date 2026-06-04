import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  newPassword: string;
}
