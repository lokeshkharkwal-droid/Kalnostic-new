import { IsEnum } from 'class-validator';
import { TripStatus } from '@prisma/client';

/** Transition a trip to a new lifecycle status. */
export class UpdateTripStatusDto {
  @IsEnum(TripStatus)
  status: TripStatus;
}
