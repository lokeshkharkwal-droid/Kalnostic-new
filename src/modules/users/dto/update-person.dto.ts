import { BloodGroup, Gender } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Editable person demographics (all optional). Uniqueness and ownership rules
 * are enforced in the service.
 */
export class UpdatePersonDto {
  @IsString()
  @IsOptional()
  @MaxLength(10)
  salutation?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @IsEnum(BloodGroup)
  @IsOptional()
  bloodGroup?: BloodGroup;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsObject()
  @IsOptional()
  address?: Record<string, unknown>;
}
