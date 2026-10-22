import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ListBranchRadiologyPanelsQueryDto } from './list-branch-radiology-panels-query.dto';

/**
 * Query for the import picker's "Available to Add" panel: the active branch's
 * Master Data radiology panels, paginated + searchable, with classification
 * filters and `excludeListId` (panels already in that pricing list are dropped
 * server-side). Extends the branch-admin list query (page/limit/search) and adds
 * the import-only filters. The branch comes from the JWT.
 */
export class ListImportableRadiologyPanelsQueryDto extends ListBranchRadiologyPanelsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  /** Exclude panels already present in this pricing list — server-side dedup. */
  @IsOptional()
  @IsUUID()
  excludeListId?: string;
}
