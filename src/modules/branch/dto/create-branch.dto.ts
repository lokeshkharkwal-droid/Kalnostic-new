import { BranchType } from '@prisma/client';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsEnum(BranchType)
  branchType: BranchType;

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
