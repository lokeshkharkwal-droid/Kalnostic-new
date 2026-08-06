import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for listing a branch's Lab Panel List: pagination + optional
 * case-insensitive `search` on panelName/panelCode + optional active `status` +
 * optional `listId` (which pricing-list tab; omitted = the branch's Walk-in list).
 */
export class ListBranchLabPanelsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Which pricing list to show (a tab). Omitted = the branch's Walk-in list. */
  @IsOptional()
  @IsUUID()
  listId?: string;

  /** Filter by enable/disable state. */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
