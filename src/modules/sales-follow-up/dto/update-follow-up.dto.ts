import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { FollowUpStatus, FollowUpType, LeadPriority } from '@prisma/client';

/**
 * Partial update of a follow-up's own fields (all optional). `leadId` is
 * immutable here — a follow-up cannot be re-parented to another lead. Status
 * transitions with history use the dedicated status endpoint.
 */
export class UpdateFollowUpDto {
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsEnum(FollowUpType)
  type?: FollowUpType;

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

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

  @IsOptional()
  @IsUUID()
  assignedSalespersonId?: string;

  @IsOptional()
  @IsEnum(FollowUpStatus)
  status?: FollowUpStatus;
}
