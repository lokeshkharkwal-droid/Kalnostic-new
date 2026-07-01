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
import { CreateAdapterLogDto } from './create-adapter-log.dto';
import { MachineReagentKitDto } from './machine-reagent-kit.dto';
import { MachineTestMappingDto } from './machine-test-mapping.dto';

/**
 * Payload to create a machine, with its reagent kits, test mappings, adapter
 * logs, and the branches it serves. `tenantId` is never in the body (set from
 * context); `departmentId` and every `branchIds` entry are validated against the
 * caller's tenant in `MachineService`.
 */
export class CreateMachineDto {
  // ── Identity ──────────────────────────────────────────────────────────────
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  machineName: string;

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

  // ── Calibration / maintenance ───────────────────────────────────────────────
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

  // ── Media / notes ───────────────────────────────────────────────────────────
  @IsString()
  @IsOptional()
  analyserImage?: string;

  @IsString()
  @IsOptional()
  machineNotes?: string;

  // ── Interface / connectivity ────────────────────────────────────────────────
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

  // ── Interface behaviour flags ───────────────────────────────────────────────
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

  // ── Nested children + branch assignments ────────────────────────────────────
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
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateAdapterLogDto)
  adapterLogs?: CreateAdapterLogDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  branchIds?: string[];
}
