import { DoctorStatus, RadiologyReportingDoctorType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query params for the radiology reporting doctors list endpoint. Extends the
 * shared offset pagination DTO with a free-text `search` (matched against
 * first/last name and registration number), a `departmentId` filter, a `status`
 * filter, a `doctorType` filter (REPORTING / CONSULTANT), and a `branchId` filter.
 */
export class ListRadiologyReportingDoctorsDto extends PaginationQueryDto {
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

  @IsEnum(RadiologyReportingDoctorType)
  @IsOptional()
  doctorType?: RadiologyReportingDoctorType;

  /** Restrict to reporting doctors scoped to this branch. */
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
