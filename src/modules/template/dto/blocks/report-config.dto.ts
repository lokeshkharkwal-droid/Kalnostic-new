import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Optional references to linked report-rendering settings (image/pdf/group
 * layout/icon settings). Stored as `Template.config.reportRefs`. These point at
 * setting tables that may not exist yet, so they are stored as opaque UUID
 * strings now and validated as logical FKs when those modules land.
 */
export class ReportRefsDto {
  @IsOptional()
  @IsUUID()
  imageSettingId?: string;

  @IsOptional()
  @IsUUID()
  pdfSettingId?: string;

  @IsOptional()
  @IsUUID()
  groupLayoutId?: string;

  @IsOptional()
  @IsUUID()
  iconSettingId?: string;
}

/**
 * REPORT_TEMPLATE type-specific payload. Stored as `Template.config` for report
 * templates: layout descriptors + raw header/footer HTML + linked setting refs.
 * `headerHtml`/`footerHtml` are raw HTML strings rendered around the report body.
 */
export class ReportConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  headerHtml?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  footerHtml?: string;

  @IsIn(['Single Column', 'Two Column', 'Grid'])
  bodyLayout: 'Single Column' | 'Two Column' | 'Grid';

  @IsIn(['Top Left', 'Top Center', 'Top Right', 'None'])
  logoPosition: 'Top Left' | 'Top Center' | 'Top Right' | 'None';

  @IsString()
  @MaxLength(100)
  primaryFont: string;

  @IsString()
  @MaxLength(10)
  fontSize: string;

  @IsIn(['A4', 'A3', 'Letter', 'Legal'])
  pageSize: 'A4' | 'A3' | 'Letter' | 'Legal';

  @IsIn(['Portrait', 'Landscape'])
  orientation: 'Portrait' | 'Landscape';

  @IsOptional()
  @ValidateNested()
  @Type(() => ReportRefsDto)
  reportRefs?: ReportRefsDto;
}
