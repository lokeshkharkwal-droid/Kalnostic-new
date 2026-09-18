import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OverallResultTemplateStatus } from '@prisma/client';

/**
 * Partial update of an Overall Result template (all fields optional; rules
 * mirror `CreateOverallResultTemplateDto`). `tenantId` is never updatable.
 */
export class UpdateOverallResultTemplateDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  groupName?: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsEnum(OverallResultTemplateStatus)
  @IsOptional()
  status?: OverallResultTemplateStatus;
}
