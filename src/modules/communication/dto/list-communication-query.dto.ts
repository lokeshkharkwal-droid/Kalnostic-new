import { IsEnum, IsOptional, IsString } from 'class-validator';
import {
  CommunicationStatus,
  MessagingChannel,
  RecipientType,
} from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Filters for the communication-log list endpoint (extends offset pagination).
 * All optional; combined with AND. `search` matches recipient name / address /
 * subject case-insensitively.
 */
export class ListCommunicationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(MessagingChannel)
  channel?: MessagingChannel;

  @IsOptional()
  @IsEnum(CommunicationStatus)
  status?: CommunicationStatus;

  @IsOptional()
  @IsEnum(RecipientType)
  recipientType?: RecipientType;

  @IsOptional()
  @IsString()
  feature?: string;

  @IsOptional()
  @IsString()
  campaign?: string;

  /** ISO date lower bound on `createdAt`. */
  @IsOptional()
  @IsString()
  from?: string;

  /** ISO date upper bound on `createdAt`. */
  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
