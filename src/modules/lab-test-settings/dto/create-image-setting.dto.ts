import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const IMG_DISPLAY_POSITIONS = [
  'Before the Next Parameter',
  'At the End of the Test Report',
  'At the End of the Entire Order',
];

export const IMG_LAYOUTS = [
  'Single Image Per Row',
  'Two Images Per Row',
  'Three Images Per Row',
  'Four Images Per Row',
  'Grid 4 : 3 : 2 : 1',
  'Grid 3 : 2 : 1',
];

export const IMG_ALIGNMENTS = ['Left', 'Center', 'Right'];

export const IMG_SIZES = [
  'Full Width',
  'Fixed Size 2',
  'Fixed Size 3',
  'Fixed Size 4',
];

export const IMG_ASPECT_RATIOS = ['1 : 1', '1 : 2', '2 : 1'];

export const IMG_PAGE_BREAKS = [
  'Allow Image to Break Across the Page',
  'Keep Image and Parameter Together on One Page',
  'Force Image on a New Page',
];

export const IMG_HEADER_RETENTIONS = [
  'Always Show Report Header Above Image',
  'Hide Header if Replacing Full Report',
  'No Header with Empty Header Space',
];

export const IMG_REPLACEMENT_MODES = [
  'Replace Entire Report with Image',
  'Not Applicable',
];

export const IMG_STATUSES = ['Active', 'Inactive'];

export class CreateImageSettingDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsIn(IMG_DISPLAY_POSITIONS)
  displayPosition: string;

  @IsIn(IMG_LAYOUTS)
  layout: string;

  @IsIn(IMG_ALIGNMENTS)
  alignment: string;

  @IsIn(IMG_SIZES)
  imageSize: string;

  @IsIn(IMG_ASPECT_RATIOS)
  @IsOptional()
  aspectRatio1?: string;

  @IsIn(IMG_ASPECT_RATIOS)
  @IsOptional()
  aspectRatio2?: string;

  @IsIn(IMG_ASPECT_RATIOS)
  @IsOptional()
  aspectRatio3?: string;

  @IsIn(IMG_ASPECT_RATIOS)
  @IsOptional()
  aspectRatio4?: string;

  @IsIn(IMG_PAGE_BREAKS)
  pageBreakControl: string;

  @IsIn(IMG_HEADER_RETENTIONS)
  headerRetention: string;

  @IsIn(IMG_REPLACEMENT_MODES)
  replacementMode: string;

  @IsIn(IMG_STATUSES)
  @IsOptional()
  status?: string;
}
