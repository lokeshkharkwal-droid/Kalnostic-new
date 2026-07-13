import { PatientCategory, PatientStatus } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /patients` — pagination (from `PaginationQueryDto`) plus an
 * optional case-insensitive `search` (matched against name and mobile), a
 * `patientCategory` filter, and a `branchId` filter (only patients registered
 * at the given branch). Tenant scoping and RLS already protect cross-tenant
 * access; `branchId` here is a read filter only.
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

  /** Filter: only patients registered at this branch. */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
