import { IsUUID } from 'class-validator';

/**
 * Clone a SITE_ADMIN template lab panel (the `:id` path param) into the caller's
 * tenant. Only the target `masterDataId` is client-supplied — `tenantId` and
 * `branchId` come from the JWT / target master data (CLAUDE.md §4.7), never the
 * body. The service deep-copies the panel, clones its referenced template tests
 * into the tenant, and rewires the join rows — all as TENANT records.
 */
export class CloneLabPanelTemplateDto {
  @IsUUID()
  masterDataId: string;
}
