import { PersonMappingType, SubCategoryPosition } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * A single mapped-party → sub-category assignment, embedded in create/update
 * payloads.
 *
 * NOTE: `tenantId`/`subCategoryId` are NOT accepted from the client — they come
 * from the request context / parent sub-category. The dynamic upper bound on
 * `priority` (≤ the tenant's per-branch mapping count) cannot be expressed with a
 * static decorator, so it is enforced in `SubCategoryService` (CLAUDE.md rule #2
 * still holds — class-validator covers the static `>= 1` floor here).
 *
 * `personId` is a polymorphic reference resolved by `type` (defaults to USER):
 * USER → persons, CONSULTANT_DOCTOR/REPORTING_DOCTOR → doctors, EXTERNAL_REFERRAL
 * → external_referrals. `branchId` (optional) scopes the mapping to one branch;
 * omit it for a tenant-level mapping that applies to all branches.
 */
export class SubCategoryPersonMappingDto {
  @IsUUID()
  personId: string;

  @IsEnum(PersonMappingType)
  @IsOptional()
  type?: PersonMappingType;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsEnum(SubCategoryPosition)
  position: SubCategoryPosition;

  @IsBoolean()
  @IsOptional()
  isSignatory?: boolean;

  @IsInt()
  @Min(1)
  priority: number;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
