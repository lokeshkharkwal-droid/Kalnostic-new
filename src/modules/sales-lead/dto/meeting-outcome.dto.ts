import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { MeetingOutcome } from '@prisma/client';

/**
 * Record the outcome of a completed meeting. The outcome maps to the lead's next
 * status; the captured fields update the lead's denormalised meeting/commercial
 * fields and create a `LeadMeeting` history row + a `LeadStatusHistory` entry.
 */
export class MeetingOutcomeDto {
  @IsEnum(MeetingOutcome) outcome: MeetingOutcome;

  @IsOptional() @IsString() @MaxLength(4000) summary?: string;
  @IsOptional() @IsString() @MaxLength(4000) requirement?: string;
  @IsOptional() @IsString() @MaxLength(4000) objections?: string;
  @IsOptional() @IsString() @MaxLength(255) competitor?: string;
  @IsOptional() @IsInt() @Min(0) expectedMonthlyBusiness?: number;
  @IsOptional() @IsString() expectedClosure?: string;
  @IsOptional() @IsString() @MaxLength(500) nextAction?: string;
  @IsOptional() @IsString() nextFollowUp?: string;
  @IsOptional() @IsString() @MaxLength(120) gps?: string;
  @IsOptional() @IsString() @MaxLength(1000) attachmentUrl?: string;
}
