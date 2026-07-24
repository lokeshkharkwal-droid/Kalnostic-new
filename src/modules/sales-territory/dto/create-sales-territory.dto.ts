import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Create a sales territory / zone at the active branch. `tenantId`/`branchId`
 * come from the JWT context, never the body (CLAUDE.md §4.7).
 */
export class CreateSalesTerritoryDto {
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
