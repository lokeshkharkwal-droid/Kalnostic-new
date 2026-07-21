import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Partial update of a service zone (all fields optional). */
export class UpdateServiceZoneDto {
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
