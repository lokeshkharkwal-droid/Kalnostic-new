import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for the Reporting Worklist's paginated/searchable Lab Test and Lab
 * Panel filter dropdowns (`GET /lab-reports/lab-test-options`,
 * `GET /lab-reports/lab-panel-options`). Extends the shared offset-pagination
 * DTO (`page`/`limit`, capped at 100) with a case-insensitive name search.
 */
export class LabReportCatalogueOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}
