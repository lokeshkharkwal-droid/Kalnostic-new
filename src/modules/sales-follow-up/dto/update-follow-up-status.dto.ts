import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { FollowUpStatus } from '@prisma/client';

/** Transition a follow-up to a new lifecycle status (recorded in history). */
export class UpdateFollowUpStatusDto {
  @IsEnum(FollowUpStatus)
  status: FollowUpStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}
