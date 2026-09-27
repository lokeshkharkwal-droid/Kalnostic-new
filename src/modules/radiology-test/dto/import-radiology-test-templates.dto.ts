import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

/**
 * Bulk-import SITE_ADMIN template radiology tests into a tenant's master data.
 * `tenantId`/`branchId` come from context, never the body. `templateIds` are the
 * SITE_ADMIN template ids to clone into `masterDataId`.
 */
export class ImportRadiologyTestTemplatesDto {
  @IsUUID()
  masterDataId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  templateIds: string[];
}
