import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { TripVisitStatus } from '@prisma/client';

/**
 * A single waypoint/visit within a trip (roadmap timeline entry). Used both when
 * seeding visits at trip-create time and when adding/updating a visit later.
 * `tenantId`/`tripId` come from context, never the body.
 */
export class TripVisitDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  sequence?: number;

  /** Optional link to the lead being visited (validated against the branch). */
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  gps?: string;

  @IsOptional()
  @IsString()
  plannedAt?: string;

  @IsOptional()
  @IsString()
  arrivedAt?: string;

  @IsOptional()
  @IsEnum(TripVisitStatus)
  status?: TripVisitStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
