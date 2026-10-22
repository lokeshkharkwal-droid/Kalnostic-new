import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';

/** Query for a master data's radiology certificates: pagination + search/group/status. */
export class ListRadiologyCertificatesDto extends PaginationQueryDto {
  /** Case-insensitive search over name + group name. */
  @IsOptional()
  @IsString()
  search?: string;

  /** Filter by group name (exact). */
  @IsOptional()
  @IsString()
  groupName?: string;

  /** Filter by active status (boolean query param — see ToBoolean). */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}
