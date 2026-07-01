import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  GROUP_LAYOUT_ALIGNMENTS,
  GROUP_LAYOUT_COLUMN_LAYOUTS,
  GROUP_LAYOUT_DISPLAY_STYLES,
  GROUP_LAYOUT_STATUSES,
} from './create-group-layout-setting.dto';

export class UpdateGroupLayoutSettingDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsIn(GROUP_LAYOUT_ALIGNMENTS)
  @IsOptional()
  nameAlignment?: string;

  @IsIn(GROUP_LAYOUT_COLUMN_LAYOUTS)
  @IsOptional()
  columnLayout?: string;

  @IsIn(GROUP_LAYOUT_ALIGNMENTS)
  @IsOptional()
  resultAlignment?: string;

  @IsIn(GROUP_LAYOUT_DISPLAY_STYLES)
  @IsOptional()
  displayStyle?: string;

  @IsIn(GROUP_LAYOUT_STATUSES)
  @IsOptional()
  status?: string;
}
