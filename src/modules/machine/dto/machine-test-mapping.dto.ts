import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * One LIS↔analyzer test mapping for a machine. `isActive` enables/disables it.
 * `tenantId`/`machineId` come from context — never the body.
 */
export class MachineTestMappingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  lisCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  lisTestName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  analyzerCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  analyzerName: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  unit?: string;

  @IsInt()
  @Min(0)
  @Max(10)
  @IsOptional()
  decimalPlaces?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
