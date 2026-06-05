import { BranchType } from '@prisma/client';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** All branch fields optional (validation rules mirror CreateBranchDto). */
export class UpdateBranchDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsEnum(BranchType)
  @IsOptional()
  branchType?: BranchType;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  code?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  email?: string;

  @IsObject()
  @IsOptional()
  address?: Record<string, unknown>;
}
