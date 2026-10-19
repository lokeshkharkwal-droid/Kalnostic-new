import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { RadiologyModality, RadiologyStudyStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Query for the radiology worklist: pagination + search + status/modality filters. */
export class ListRadiologyStudiesDto extends PaginationQueryDto {
  /** Free-text match on study no, test name, or body part. */
  @IsOptional()
  @IsString()
  search?: string;

  /** Filter by lifecycle status. */
  @IsOptional()
  @IsEnum(RadiologyStudyStatus)
  status?: RadiologyStudyStatus;

  /** Filter by imaging modality. */
  @IsOptional()
  @IsEnum(RadiologyModality)
  modality?: RadiologyModality;

  /** Filter to a single radiologist (a staff Person id). */
  @IsOptional()
  @IsUUID()
  radiologistId?: string;

  /** Filter to a single order. */
  @IsOptional()
  @IsUUID()
  orderId?: string;
}
