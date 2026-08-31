import { IsEnum } from 'class-validator';
import { AccessionGroupingMode } from '@prisma/client';

/**
 * Body for `PUT /tenant/grouping-mode` — the Accession Group Settings toggle
 * (Kalnostic_LIMS_Accession_Group_Settings.docx). Tenant-wide, business-admin
 * only. See `AccessionGroupingMode`'s Prisma doc comment for what each mode
 * means; changing this does NOT affect physical sample generation or
 * retroactively re-group already-accessioned orders (doc §5).
 */
export class UpdateGroupingModeDto {
  @IsEnum(AccessionGroupingMode)
  groupingMode: AccessionGroupingMode;
}
