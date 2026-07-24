import { IsUUID } from 'class-validator';

/** Query for `GET /lab-reports/:id/trend` (LABORATORY.docx §5.10). */
export class TrendReportQueryDto {
  @IsUUID()
  resultParamId: string;
}
