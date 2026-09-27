import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for listing a branch's Opd Panel List: pagination + optional
 * case-insensitive `search` on panelName/panelCode + optional active `status` +
 * optional `listId` (which pricing-list tab; omitted = the branch's Walk-in list).
 */
export class ListBranchOpdPanelsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @IsUUID()
  listId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
