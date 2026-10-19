import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { RadiologyModality } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for listing a branch's Radiology Test List: pagination + optional
 * case-insensitive `search` on testName/testCode + optional `modality` +
 * optional active `status` + optional `listId` (which pricing-list tab; omitted =
 * the branch's Walk-in list).
 */
export class ListBranchRadiologyTestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Filter by imaging modality. */
  @IsOptional()
  @IsEnum(RadiologyModality)
  modality?: RadiologyModality;

  /** Which pricing list to show (a tab). Omitted = the branch's Walk-in list. */
  @IsOptional()
  @IsUUID()
  listId?: string;

  /** Filter by enable/disable state. */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
