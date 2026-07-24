import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { FollowUpStatus, FollowUpType, LeadPriority } from '@prisma/client';

/**
 * Create a sales follow-up at the active branch. The follow-up hangs off a lead
 * (required) and may reference the trip it was scheduled during. `tenantId`/
 * `branchId` come from the JWT context, never the body (CLAUDE.md §4.7).
 */
export class CreateFollowUpDto {
  /** Lead this follow-up belongs to (required; Lead → many FollowUps). */
  @IsUUID()
  leadId: string;

  /** Optional trip during which this follow-up was scheduled. */
  @IsOptional()
  @IsUUID()
  tripId?: string;

  /** Channel of the follow-up (required). */
  @IsEnum(FollowUpType)
  type: FollowUpType;

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  /** ISO datetime the follow-up is due. */
  @IsOptional()
  @IsString()
  dueAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  requirement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  lastDiscussion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  nextAction?: string;

  /** Staff Person the follow-up is assigned to. */
  @IsOptional()
  @IsUUID()
  assignedSalespersonId?: string;

  @IsOptional()
  @IsEnum(FollowUpStatus)
  status?: FollowUpStatus;
}
