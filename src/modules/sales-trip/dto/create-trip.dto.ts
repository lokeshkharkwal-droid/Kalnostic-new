import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TripStatus } from '@prisma/client';
import { TripVisitDto } from './trip-visit.dto';

/**
 * Create a field-sales trip at the active branch (the priority POST). Salesperson
 * is any staff Person in the tenant (validated in the service). `tenantId`/
 * `branchId` come from the JWT context, never the body (CLAUDE.md §4.7).
 */
export class CreateTripDto {
  /** Staff Person who runs the trip (required). */
  @IsUUID()
  salespersonId: string;

  /** Optional lead this trip was started from (Lead → many Trips). */
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsString()
  tripDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  startingLocation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  startingGps?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  startingTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  endingLocation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  endingGps?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  endingTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  kmTravelled?: number;

  @IsOptional()
  @IsEnum(TripStatus)
  status?: TripStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** Optional initial visits/waypoints for this trip. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TripVisitDto)
  visits?: TripVisitDto[];
}
