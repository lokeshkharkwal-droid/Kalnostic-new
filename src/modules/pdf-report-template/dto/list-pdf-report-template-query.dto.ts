import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PDF_REPORT_TEMPLATE_TYPES } from '../constants/pdf-report-template-types.constant';
import type { PdfReportTemplateType } from '../constants/pdf-report-template-types.constant';

/**
 * Query for `GET /pdf-report-templates` — pagination (from `PaginationQueryDto`)
 * plus an optional case-insensitive `search` over the name, a `type` filter, an
 * active/inactive `status` filter, and a `branchId` filter.
 */
export class ListPdfReportTemplateQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @IsIn(PDF_REPORT_TEMPLATE_TYPES)
  type?: PdfReportTemplateType;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsUUID()
  branchId?: string;
}
