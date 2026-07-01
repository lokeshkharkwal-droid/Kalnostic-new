import { CategoryPosition, PersonMappingType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * A single mapped-party → category assignment, embedded in create/update
 * payloads.
 *
 * NOTE: `tenantId`/`categoryId` are NOT accepted from the client — they come
 * from the request context / parent category. The dynamic upper bound on
 * `priority` (≤ the tenant's per-branch mapping count) cannot be expressed with a
 * static decorator, so it is enforced in `CategoryService` (CLAUDE.md rule #2
 * still holds — class-validator covers the static `>= 1` floor here).
 *
 * `personId` is a polymorphic reference resolved by `type` (defaults to USER):
 * USER → persons, CONSULTANT_DOCTOR/REPORTING_DOCTOR → doctors, EXTERNAL_REFERRAL
 * → external_referrals. `branchId` (optional) scopes the mapping to one branch;
 * omit it for a tenant-level mapping that applies to all branches.
 */
export class CategoryPersonMappingDto {
  @IsUUID()
  personId: string;

  @IsEnum(PersonMappingType)
  @IsOptional()
  type?: PersonMappingType;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsEnum(CategoryPosition)
  position: CategoryPosition;

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
