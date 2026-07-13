import { IsOptional, IsUUID } from 'class-validator';

/**
 * Query DTO for the document status-summary endpoint. `branchId` is optional:
 * present → counts for that branch only (verified to belong to the caller's
 * tenant, §4.5); absent → counts across all branches of the tenant.
 */
export class DocumentSummaryQueryDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
