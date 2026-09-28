import { AdapterStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for listing a tenant's Lab Adapters: pagination + optional
 * case-insensitive `search` on the adapter name + optional `status` filter.
 */
export class ListLabAdapterQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Filter to one of the 3 operating states (ONLINE/REPORT_ONLY/INACTIVE). */
  @IsOptional()
  @IsEnum(AdapterStatus)
  status?: AdapterStatus;
}
