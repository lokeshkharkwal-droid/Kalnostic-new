import { IsUUID } from 'class-validator';

/**
 * Clone a SITE_ADMIN template radiology test (the `:id` path param) into the
 * caller's tenant. Only the target `masterDataId` is client-supplied — `tenantId`
 * and `branchId` come from the JWT / target master data (CLAUDE.md §4.7).
 */
export class CloneRadiologyTestTemplateDto {
  @IsUUID()
  masterDataId: string;
}
