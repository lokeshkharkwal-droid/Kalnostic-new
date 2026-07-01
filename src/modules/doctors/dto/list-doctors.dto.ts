import { DoctorStatus, DoctorType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query params for the doctors list endpoint. Extends the shared offset
 * pagination DTO with a free-text `search` (matched against first/last name and
 * registration number), a `departmentId` filter, a `status` filter, a
 * `doctorType` filter (CONSULTANT / REPORTING) used by pickers that need only
 * one kind of doctor, and a `branchId` filter (doctors assigned to that branch).
 */
export class ListDoctorsDto extends PaginationQueryDto {
  /** Free-text match against firstName, lastName, or registrationNo. */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsEnum(DoctorStatus)
  @IsOptional()
  status?: DoctorStatus;

  @IsEnum(DoctorType)
  @IsOptional()
  doctorType?: DoctorType;

  /** Restrict to doctors with an active assignment to this branch. */
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
