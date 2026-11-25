import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for the patient's lab-order list (`GET /patient-portal/lab-orders`).
 * Offset pagination (`page`/`limit`) comes from {@link PaginationQueryDto}.
 *
 * `patientId` narrows the list to one person (the "Viewing" family-member
 * dropdown). It is only ever INTERSECTED with the patients the session may view
 * — it can never widen the scope — so an id that is not the caller's own or a
 * linked family member's yields an empty list.
 */
export class ListPatientLabOrdersQueryDto extends PaginationQueryDto {
  /** Narrow to one viewable patient (self or a linked family member). */
  @IsOptional()
  @IsUUID()
  patientId?: string;

  /** Free text over the order number, external order id and test/panel names. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;

  /** Inclusive lower bound on the order date (ISO-8601 date). */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Inclusive upper bound on the order date (ISO-8601 date). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
