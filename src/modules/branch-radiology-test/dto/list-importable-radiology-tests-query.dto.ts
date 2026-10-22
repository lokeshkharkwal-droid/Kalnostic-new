import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ListBranchRadiologyTestsQueryDto } from './list-branch-radiology-tests-query.dto';

/**
 * Query for the import picker's "Available to Add" panel: the active branch's
 * Master Data radiology tests, paginated + searchable, with classification
 * filters and `excludeListId` (tests already in that pricing list are dropped
 * server-side). Extends the branch-admin list query (page/limit/search) and
 * adds the import-only filters. The branch comes from the JWT.
 */
export class ListImportableRadiologyTestsQueryDto extends ListBranchRadiologyTestsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subCategory?: string;

  /** Exclude tests already present in this pricing list — server-side dedup. */
  @IsOptional()
  @IsUUID()
  excludeListId?: string;
}
