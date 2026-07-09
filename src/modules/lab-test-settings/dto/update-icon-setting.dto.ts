import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ICON_STATUSES, IconConfigDto } from './create-icon-setting.dto';

/**
 * The JSON metadata part of the multipart Update Icon Setting request. All
 * fields optional — only supplied fields are changed. When `icons` is
 * supplied, replacement icon files (`icon1` / `icon2`) are optional per slot:
 * an existing icon's image is kept unless a new file is sent for that slot.
 */
export class UpdateIconSettingDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => IconConfigDto)
  @IsOptional()
  icons?: IconConfigDto[];

  @IsIn(ICON_STATUSES)
  @IsOptional()
  status?: string;
}
