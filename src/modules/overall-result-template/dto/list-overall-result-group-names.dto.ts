import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the distinct group-names lookup
 * (`GET /overall-result-templates/group-names`). Extends the shared
 * pagination DTO with a case-insensitive `search` on the group name.
 */
export class ListOverallResultGroupNamesDto extends PaginationQueryDto {
  /** Case-insensitive match against the group name. */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  search?: string;
}
