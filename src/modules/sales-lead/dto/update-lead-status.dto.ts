import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { LeadStatus } from '@prisma/client';

/**
 * Transition a lead to a new status (the per-row "Immediate Action" / manual
 * status change). Records a `LeadStatusHistory` entry. When the transition is
 * `CONFIRMED → STARTED` and the lead has an assigned salesperson, a linked Trip
 * is created automatically (the "Start Trip" flow).
 */
export class UpdateLeadStatusDto {
  @IsEnum(LeadStatus) status: LeadStatus;

  /** Optional GPS + note captured with the change. */
  @IsOptional() @IsString() @MaxLength(120) gps?: string;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}
