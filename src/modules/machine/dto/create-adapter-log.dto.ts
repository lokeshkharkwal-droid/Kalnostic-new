import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { AdapterLogType } from '@prisma/client';

/**
 * Payload for an adapter communication log line for a machine. Used both by the
 * standalone append endpoint (`POST /machines/:id/adapter-logs`) and as the nested
 * `adapterLogs[]` entry on machine creation. Written by the adapter/integration
 * layer. `tenantId`/`machineId` come from context — never the body.
 */
export class CreateAdapterLogDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  srNo?: number;

  @IsDateString()
  @IsOptional()
  loggedAt?: string;

  @IsEnum(AdapterLogType)
  @IsOptional()
  logType?: AdapterLogType;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  status?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  sourceIp?: string;
}
