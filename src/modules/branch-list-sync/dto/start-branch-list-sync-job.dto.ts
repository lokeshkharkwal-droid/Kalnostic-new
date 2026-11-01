import { IsOptional, IsUUID } from 'class-validator';

/**
 * Start payload for a background "Sync from Master Data" job. The sync always does
 * a full reconcile (add/update/delete) of the target list against Branch Master
 * Data; `listId` picks the pricing list (omit = the branch's Walk-in list). The
 * tenant + active branch come from the JWT (never the body).
 */
export class StartBranchListSyncJobDto {
  @IsOptional()
  @IsUUID()
  listId?: string;
}
