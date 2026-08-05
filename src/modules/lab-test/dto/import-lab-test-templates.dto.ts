import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

/**
 * Bulk-import SITE_ADMIN template lab tests into a tenant's master data.
 * `tenantId`/`branchId` come from context (JWT + the master data), never the
 * body. `templateIds` are the SITE_ADMIN template ids to clone into
 * `masterDataId`; already-imported templates are skipped server-side.
 */
export class ImportLabTestTemplatesDto {
  /** Target master data (validated against the caller's tenant in the service). */
  @IsUUID()
  masterDataId: string;

  /** SITE_ADMIN template lab-test ids to import (1..500, de-duplicated). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  templateIds: string[];
}
