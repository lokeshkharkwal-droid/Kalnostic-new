import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  IMG_ALIGNMENTS,
  IMG_ASPECT_RATIOS,
  IMG_DISPLAY_POSITIONS,
  IMG_HEADER_RETENTIONS,
  IMG_LAYOUTS,
  IMG_PAGE_BREAKS,
  IMG_REPLACEMENT_MODES,
  IMG_SIZES,
  IMG_STATUSES,
} from './create-image-setting.dto';

export class UpdateImageSettingDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsIn(IMG_DISPLAY_POSITIONS)
  @IsOptional()
  displayPosition?: string;

  @IsIn(IMG_LAYOUTS)
  @IsOptional()
  layout?: string;

  @IsIn(IMG_ALIGNMENTS)
  @IsOptional()
  alignment?: string;

  @IsIn(IMG_SIZES)
  @IsOptional()
  imageSize?: string;

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
  @IsOptional()
  pageBreakControl?: string;

  @IsIn(IMG_HEADER_RETENTIONS)
  @IsOptional()
  headerRetention?: string;

  @IsIn(IMG_REPLACEMENT_MODES)
  @IsOptional()
  replacementMode?: string;

  @IsIn(IMG_STATUSES)
  @IsOptional()
  status?: string;
}
