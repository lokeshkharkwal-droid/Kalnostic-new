import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * One reagent kit used by a machine. `tenantId`/`machineId` come from context —
 * never the body.
 */
export class MachineReagentKitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reagentKitName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  manufacturer: string;

  @IsString()
  @IsOptional()
  details?: string;
}
