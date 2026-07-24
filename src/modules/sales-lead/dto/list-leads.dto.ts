import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  AgreementStatus,
  LeadPriority,
  LeadStatus,
  PipelineStage,
  SalesDocumentStatus,
} from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { STATUS_BUCKET_KEYS } from '../entities/sales-lead.constants';

/**
 * Query for listing leads. Mirrors the FE filter bar: pagination + status-bucket
 * tab + 13 dropdown filters + date range + global search. Every filter is
 * optional; scoping to `{ tenantId, branchId, deletedAt: null }` is always applied.
 */
export class ListLeadsDto extends PaginationQueryDto {
  /** Free-text: matches leadCode / org / contact / mobile / email / city / GST. */
  @IsOptional() @IsString() @MaxLength(255) search?: string;

  /** Sidebar status-bucket tab (maps to a set of granular statuses). */
  @IsOptional() @IsIn(STATUS_BUCKET_KEYS) statusBucket?: string;

  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;

  @IsOptional() @IsUUID() salespersonId?: string;
  @IsOptional() @IsUUID() territoryId?: string;
  @IsOptional() @IsString() @MaxLength(120) source?: string;
  @IsOptional() @IsString() @MaxLength(120) category?: string;
  @IsOptional() @IsString() @MaxLength(120) organizationType?: string;
  @IsOptional() @IsEnum(LeadPriority) priority?: LeadPriority;
  @IsOptional() @IsEnum(PipelineStage) pipelineStage?: PipelineStage;
  @IsOptional() @IsEnum(LeadStatus) status?: LeadStatus;
  @IsOptional() @IsEnum(AgreementStatus) agreementStatus?: AgreementStatus;
  @IsOptional()
  @IsEnum(SalesDocumentStatus)
  proposalStatus?: SalesDocumentStatus;
  @IsOptional()
  @IsEnum(SalesDocumentStatus)
  quotationStatus?: SalesDocumentStatus;
  @IsOptional() @IsString() @MaxLength(64) billingType?: string;
}
