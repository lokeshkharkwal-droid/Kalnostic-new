import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { OutsourceContactRole } from '@prisma/client';

/**
 * A single contact person on an outsource center. The five roles are fixed; all
 * detail fields are optional. Contact entries whose name, mobile, and email are
 * all empty are dropped by the service rather than persisted.
 */
export class OutsourceCenterContactDto {
  @IsEnum(OutsourceContactRole)
  role: OutsourceContactRole;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  mobile?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  email?: string;
}
