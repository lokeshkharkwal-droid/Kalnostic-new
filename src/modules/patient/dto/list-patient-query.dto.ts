import {
  BloodGroup,
  Gender,
  PatientCategory,
  PatientStatus,
} from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /patients` — pagination (from `PaginationQueryDto`) plus
 * optional filters: case-insensitive `search` (name/mobile), `patientCategory`,
 * lifecycle `status`, `isActive` (Active/Inactive), `gender`, `bloodGroup`, a
 * registration-date range (`dateFrom`/`dateTo` on `createdAt`), and `branchId`
 * (only patients registered at the given branch). Tenant scoping and RLS already
 * protect cross-tenant access; these are read filters only.
 */
export class ListPatientQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against first/middle/last name and mobile. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /** Filter: only patients in this category. */
  @IsOptional()
  @IsEnum(PatientCategory)
  patientCategory?: PatientCategory;

  /** Filter: only patients in this lifecycle stage (`DRAFT`/`CREATED`). */
  @IsOptional()
  @IsEnum(PatientStatus)
  status?: PatientStatus;

  /** Filter: Active (`true`) / Inactive (`false`). Query strings coerced. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  /** Filter: only patients with this gender. */
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  /** Filter: only patients with this blood group. */
  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroup?: BloodGroup;

  /** Inclusive lower bound on the registration date (`createdAt`, ISO-8601). */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Inclusive upper bound on the registration date (`createdAt`, ISO-8601). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Filter: only patients registered at this branch. */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /**
   * When `true`, each returned patient carries its active family members
   * (`familyMembers`). Default OFF so existing consumers are unaffected. Query
   * strings are coerced via `@ToBoolean()` (avoids the implicit-conversion
   * `false → true` bug).
   */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeFamily?: boolean;
}
