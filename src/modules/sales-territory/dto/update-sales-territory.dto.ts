import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Partial update of a sales territory (all fields optional). */
export class UpdateSalesTerritoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
