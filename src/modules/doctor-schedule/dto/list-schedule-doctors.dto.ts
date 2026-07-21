import { DoctorStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Sortable columns for the Doctor List (Tab 1). */
export type DoctorListSortBy =
  | 'name'
  | 'branch'
  | 'department'
  | 'speciality'
  | 'initialConsultationFee'
  | 'followUpConsultationFee'
  | 'assignedAppointments'
  | 'completedAppointments'
  | 'status';

const SORT_BY: DoctorListSortBy[] = [
  'name',
  'branch',
  'department',
  'speciality',
  'initialConsultationFee',
  'followUpConsultationFee',
  'assignedAppointments',
  'completedAppointments',
  'status',
];

/**
 * Query for the Doctor List tab: paginated list of CONSULTANT doctors enriched
 * with dynamic appointment counts. Supports a name `search`, branch / department
 * / speciality / status filters, and sorting.
 */
export class ListScheduleDoctorsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** Speciality = the doctor's linked category. */
  @IsOptional()
  @IsUUID()
  specialityId?: string;

  @IsOptional()
  @IsEnum(DoctorStatus)
  status?: DoctorStatus;

  @IsOptional()
  @IsIn(SORT_BY)
  sortBy?: DoctorListSortBy;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
