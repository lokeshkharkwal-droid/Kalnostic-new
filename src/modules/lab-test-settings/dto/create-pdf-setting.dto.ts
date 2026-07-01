import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const PDF_MODES = [
  'Append at End',
  'Replace Full Report',
  'Header + PDF',
  'Inline',
];

export const PDF_PLACEMENTS = [
  'After Parameter',
  'End of Report',
  'Custom Section',
];

export const PDF_SCALE_MODES = ['Auto', 'Fit to Page', 'Custom %'];

export const PDF_PAGE_BREAKS = [
  'Auto Flow',
  'Each PDF New Page',
  'Group per Page',
];

export const PDF_STATUSES = ['Active', 'Inactive'];

export class CreatePdfSettingDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsIn(PDF_MODES)
  pdfMode: string;

  @IsIn(PDF_PLACEMENTS)
  placement: string;

  @IsIn(PDF_SCALE_MODES)
  scaleMode: string;

  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  customScalePct?: number;

  @IsIn(PDF_PAGE_BREAKS)
  pageBreakControl: string;

  @IsIn(PDF_STATUSES)
  @IsOptional()
  status?: string;
}
