import { AuditAction, AuditModule } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Filters for the audit-log list endpoint, on top of offset pagination.
 * All fields are optional; `tenantId` is never accepted here — it comes from
 * the request context (CLAUDE.md §4.7).
 */
export class QueryAuditDto extends PaginationQueryDto {
  /**
   * Free-text search (case-insensitive substring) matched against the actor
   * (person id / role label) and the description.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Restrict to a single module (user / branch / schedule / …). */
  @IsOptional()
  @IsEnum(AuditModule)
  module?: AuditModule;

  /** Restrict to a single action (CREATE / UPDATE / …). */
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  /** Restrict to events performed by a specific person. */
  @IsOptional()
  @IsString()
  actorPersonId?: string;

  /** Restrict to events at a specific branch. */
  @IsOptional()
  @IsString()
  branchId?: string;

  /** Inclusive lower bound on `createdAt` (ISO-8601 date or datetime). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive upper bound on `createdAt` (ISO-8601 date or datetime). */
  @IsOptional()
  @IsDateString()
  to?: string;
}
