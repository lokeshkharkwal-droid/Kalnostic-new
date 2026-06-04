import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SiteAdminLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  password: string;
}
