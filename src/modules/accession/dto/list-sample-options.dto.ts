import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { SampleOptionField } from '../utils/sample-options.util';

/** Query of `GET /accession/order-samples/sample-options`. */
export class ListSampleOptionsDto extends PaginationQueryDto {
  /** Which dropdown: the sample's `name` or its `type`. */
  @IsIn(['name', 'type'])
  field!: SampleOptionField;

  /** Part of a name / spelling to look for (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
