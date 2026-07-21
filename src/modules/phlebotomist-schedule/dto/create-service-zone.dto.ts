import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Create a service area / zone at the active branch. `tenantId`/`branchId` come
 * from the JWT context, never the body (CLAUDE.md §4.7).
 */
export class CreateServiceZoneDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
