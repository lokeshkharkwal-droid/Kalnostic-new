import { CategoryPosition } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * A single person → category assignment, embedded in create/update payloads.
 *
 * NOTE: `tenantId`/`categoryId` are NOT accepted from the client — they come
 * from the request context / parent category. The dynamic upper bound on
 * `priority` (≤ the tenant's total mapping count) cannot be expressed with a
 * static decorator, so it is enforced in `CategoryService` (CLAUDE.md rule #2
 * still holds — class-validator covers the static `>= 1` floor here).
 */
export class CategoryPersonMappingDto {
  @IsUUID()
  personId: string;

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
