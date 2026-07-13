import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Partial update for a phlebotomist. All fields optional (explicit, per SKILL.md).
 */
export class UpdatePhlebotomistDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  designation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  mobile?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}
