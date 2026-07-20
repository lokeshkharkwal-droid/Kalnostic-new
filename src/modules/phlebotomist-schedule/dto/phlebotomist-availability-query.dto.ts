import { IsOptional, IsUUID, Matches } from 'class-validator';

/**
 * Query for the create-order home-visit availability endpoint: the required
 * phlebotomist and an optional `[from, to)` date window (each `YYYY-MM-DD`).
 * When omitted, the service defaults to today through the generated horizon.
 */
export class PhlebotomistAvailabilityQueryDto {
  @IsUUID()
  phlebotomistId!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be a YYYY-MM-DD date' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be a YYYY-MM-DD date' })
  to?: string;
}
