import { DoctorStatus } from '@prisma/client';
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
 * registration number), a `departmentId` filter, and a `status` filter.
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
}
