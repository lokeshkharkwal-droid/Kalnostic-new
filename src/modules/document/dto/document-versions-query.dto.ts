import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for the read-only version-history endpoint: offset pagination plus
 * an optional branch scope. Present → that branch only (verified to belong to
 * the caller's tenant, §4.5); absent → tenant-wide (Business Admin, which has no
 * active branch). Declaring `branchId` here is required so the global
 * whitelist-validation pipe does not reject it.
 */
export class DocumentVersionsQueryDto extends PaginationQueryDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
