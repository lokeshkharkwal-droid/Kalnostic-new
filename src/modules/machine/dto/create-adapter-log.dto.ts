import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdapterLogType } from '@prisma/client';

/**
 * Payload to append an adapter communication log line for a machine. Written by
 * the adapter/integration layer. `tenantId`/`machineId` come from context.
 */
export class CreateAdapterLogDto {
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
