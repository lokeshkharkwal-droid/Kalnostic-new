import { Relationship } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Body for `POST /patients/:patientId/family-members`. Creates a new, independent
 * `Patient` for the family member and links it to the anchor patient. Only the
 * fields below are persisted on the new patient — the anchor's data is never
 * copied. `tenantId` (JWT) and the registration `branchId` (active profile) come
 * from the request context, never the body (CLAUDE.md §4.7). `relationship` is
 * validated against the Prisma enum so invalid values are rejected before any
 * write.
 */
export class CreateFamilyMemberDto {
  /** The family member's name — stored as the new patient's `firstName`. */
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  /** The family member's age in years (optional). */
  @IsInt()
  @Min(0)
  @IsOptional()
  age?: number;

  /** The family member's mobile number (required; unique per tenant). */
  @IsString()
  @MinLength(4)
  @MaxLength(30)
  mobile: string;

  /** Relationship of the family member to the anchor patient. */
  @IsEnum(Relationship)
  relationship: Relationship;

  /** Frontend-supplied UMID for the new patient (optional). */
  @IsString()
  @IsOptional()
  @MaxLength(60)
  umId?: string;
}
