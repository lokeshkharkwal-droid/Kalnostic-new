import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { RadiologyModality, RadiologyStudyStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Query for the radiology worklist: pagination + search + status/modality filters. */
export class ListRadiologyStudiesDto extends PaginationQueryDto {
  /** Free-text match on study no, test name, or body part. */
  @IsOptional()
  @IsString()
  search?: string;

  /** Filter by a single lifecycle status. */
  @IsOptional()
  @IsEnum(RadiologyStudyStatus)
  status?: RadiologyStudyStatus;

  /**
   * Filter by MULTIPLE lifecycle statuses (comma-separated), e.g.
   * `SCHEDULED,ACQUIRED,REPORTED`. Used by the worklist's collapsed
   * New / In Progress / Published tabs, where "In Progress" spans several
   * underlying statuses. Takes precedence over `status` when present.
   */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : value,
  )
  @IsEnum(RadiologyStudyStatus, { each: true })
  statuses?: RadiologyStudyStatus[];

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
