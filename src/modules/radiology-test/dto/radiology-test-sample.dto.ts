import { ContainerType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A sample requirement for a radiology test, embedded under the create/update
 * payload. Context/parent ids are not accepted from the client. At most one
 * sample per test may have `isDefault: true`.
 */
export class RadiologyTestSampleDto {
  @IsUUID()
  @IsOptional()
  sampleNameId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  sampleName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  sampleType?: string;

  @IsEnum(ContainerType)
  @IsOptional()
  containerType?: ContainerType;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  sampleSize?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  collectionMethod?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  numberOfSamples?: number;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  stability?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  transportTemperature?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  preservative?: string;

  @IsString()
  @IsOptional()
  sampleHandlingInstructions?: string;

  @IsBoolean()
  @IsOptional()
  isFastingRequired?: boolean;

  @IsBoolean()
  @IsOptional()
  isLightProtection?: boolean;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
