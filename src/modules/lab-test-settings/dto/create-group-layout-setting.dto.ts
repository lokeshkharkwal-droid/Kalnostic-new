import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const GROUP_LAYOUT_ALIGNMENTS = ['Left', 'Center', 'Right'];

export const GROUP_LAYOUT_COLUMN_LAYOUTS = [
  '1 Column',
  '2 Columns',
  '3 Columns',
];

export const GROUP_LAYOUT_DISPLAY_STYLES = [
  'Grid (Side-by-side)',
  'Sequential (Top → Bottom)',
];

export const GROUP_LAYOUT_STATUSES = ['Active', 'Inactive'];

export class CreateGroupLayoutSettingDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsIn(GROUP_LAYOUT_ALIGNMENTS)
  nameAlignment: string;

  @IsIn(GROUP_LAYOUT_COLUMN_LAYOUTS)
  columnLayout: string;

  @IsIn(GROUP_LAYOUT_ALIGNMENTS)
  resultAlignment: string;

  @IsIn(GROUP_LAYOUT_DISPLAY_STYLES)
  displayStyle: string;

  @IsIn(GROUP_LAYOUT_STATUSES)
  @IsOptional()
  status?: string;
}
