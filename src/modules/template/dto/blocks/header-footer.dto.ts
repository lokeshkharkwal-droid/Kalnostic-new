import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * A header or footer block shared across template types. Persisted inside the
 * template's `header_block` / `footer_block` JSON columns (not a separate table).
 * `imageFile` holds a filename/key string only (no upload pipeline in this phase).
 */
export class HeaderFooterDto {
  @IsBoolean()
  enabled: boolean;

  @IsIn(['Text', 'Image'])
  type: 'Text' | 'Image';

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  imageFile?: string;

  @IsIn(['Left', 'Center', 'Right'])
  alignment: 'Left' | 'Center' | 'Right';
}
