import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MachineStatus } from '@prisma/client';
import { MachineReagentKitDto } from './machine-reagent-kit.dto';
import { MachineTestMappingDto } from './machine-test-mapping.dto';

/**
 * Partial update for a machine. Every field is optional; fields are re-declared
 * (not `PartialType`) so the validation rules stay visible (SKILL.md §4). When
 * `reagentKits`/`testMappings`/`branchIds` are provided, the whole set is
 * replaced (old active rows soft-deleted, the new set created).
 */
export class UpdateMachineDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  machineName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  code?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  manufacturer?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  model?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  serialNo?: string;

  @IsString()
  @IsOptional()
  departmentId?: string;

  @IsEnum(MachineStatus)
  @IsOptional()
  status?: MachineStatus;

  @IsDateString()
  @IsOptional()
  lastCalibrationDate?: string;

  @IsDateString()
  @IsOptional()
  lastMaintenanceDate?: string;

  @IsDateString()
  @IsOptional()
  nextCalibrationDate?: string;

  @IsDateString()
  @IsOptional()
  nextMaintenanceDue?: string;

  @IsString()
  @IsOptional()
  analyserImage?: string;

  @IsString()
  @IsOptional()
  machineNotes?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  interfaceType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  tokenNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  connectionType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  hostPcIpAddress?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  analyserIpAddress?: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  port?: number;

  @IsBoolean()
  @IsOptional()
  isAdapterServer?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  adapterSupports?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  referenceImages?: string[];

  @IsString()
  @IsOptional()
  interfaceNote?: string;

  @IsBoolean()
  @IsOptional()
  isBidirectionalInterface?: boolean;

  @IsBoolean()
  @IsOptional()
  isAutoValidateResults?: boolean;

  @IsBoolean()
  @IsOptional()
  isAutoFlagCritical?: boolean;

  @IsString()
  @IsOptional()
  interfaceConfigurationNotes?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MachineReagentKitDto)
  reagentKits?: MachineReagentKitDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MachineTestMappingDto)
  testMappings?: MachineTestMappingDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  branchIds?: string[];
}
