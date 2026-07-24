import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { TripStatus } from '@prisma/client';

/** Partial update of a trip's own fields (all optional). Visits are managed via
 * the dedicated visit endpoints. */
export class UpdateTripDto {
  @IsOptional()
  @IsUUID()
  salespersonId?: string;

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
}
