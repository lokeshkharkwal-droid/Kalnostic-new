import { IsUUID } from 'class-validator';

/**
 * Clone a SITE_ADMIN template lab test (the `:id` path param) into the caller's
 * tenant. Only the target `masterDataId` is client-supplied — `tenantId` and
 * `branchId` come from the JWT / target master data (CLAUDE.md §4.7), never the
 * body. The service deep-copies the test + its children as a TENANT record.
 */
export class CloneLabTestTemplateDto {
  @IsUUID()
  masterDataId: string;
}
