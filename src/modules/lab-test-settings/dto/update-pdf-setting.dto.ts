import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PDF_MODES,
  PDF_PAGE_BREAKS,
  PDF_PLACEMENTS,
  PDF_SCALE_MODES,
  PDF_STATUSES,
} from './create-pdf-setting.dto';

export class UpdatePdfSettingDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsIn(PDF_MODES)
  @IsOptional()
  pdfMode?: string;

  @IsIn(PDF_PLACEMENTS)
  @IsOptional()
  placement?: string;

  @IsIn(PDF_SCALE_MODES)
  @IsOptional()
  scaleMode?: string;

  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  customScalePct?: number;

  @IsIn(PDF_PAGE_BREAKS)
  @IsOptional()
  pageBreakControl?: string;

  @IsIn(PDF_STATUSES)
  @IsOptional()
  status?: string;
}
