import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const ICON_COUNTS = [1, 2];

export const ICON_POSITIONS = [
  'Before Parameter Name',
  'After Parameter Name',
  'Before Result',
  'After Result',
  'Extreme Left',
  'Extreme Right',
];

export const ICON_ALIGNMENTS = ['Left', 'Center', 'Right'];

export const ICON_SIZES = ['Small', 'Medium', 'Large'];

export const ICON_VISIBILITIES = ['Always', 'Abnormal Only', 'Critical Only'];

export const ICON_STATUSES = ['Active', 'Inactive'];

/** Allowed MIME types for icon uploads (PNG/SVG/JPG). */
export const ALLOWED_ICON_MIME_TYPES = [
  'image/png',
  'image/svg+xml',
  'image/jpeg',
  'image/jpg',
] as const;

/**
 * One icon's configuration. `iconUrl` is set by the service after storing the
 * uploaded file — never accepted from the client.
 */
export class IconConfigDto {
  @IsIn(ICON_POSITIONS)
  position: string;

  @IsIn(ICON_ALIGNMENTS)
  alignment: string;

  @IsIn(ICON_SIZES)
  size: string;

  @IsIn(ICON_VISIBILITIES)
  visibility: string;
}

/**
 * The JSON metadata part of the multipart Create Icon Setting request (the
 * files themselves arrive as `icon1` / `icon2` form fields, matched by array
 * index to `icons[0]` / `icons[1]`).
 */
export class CreateIconSettingDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => IconConfigDto)
  icons: IconConfigDto[];

  @IsIn(ICON_STATUSES)
  status?: string;
}
