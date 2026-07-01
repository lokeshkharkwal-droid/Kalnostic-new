import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Where an attachment is positioned, per template type (superset of all tabs). */
const ATTACHMENT_POSITIONS = [
  'Before Body',
  'Inline',
  'After Body',
  'Before Params',
  'After Params',
  'End of Report',
  'Media Header',
  'Media Footer',
] as const;

/**
 * An attachment rule shared across template types. Persisted inside the
 * template's `attachment` JSON column (not a separate table). `files` holds
 * filename/key strings only (no upload pipeline in this phase). SMS templates do
 * not support attachments (`shortLinkGenerator` stands in for SMS short links).
 */
export class AttachmentRuleDto {
  @IsBoolean()
  enabled: boolean;

  @IsIn(['Image', 'PDF', 'Both'])
  type: 'Image' | 'PDF' | 'Both';

  @IsArray()
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  @ArrayMaxSize(50)
  files: string[];

  @IsIn(ATTACHMENT_POSITIONS)
  position: (typeof ATTACHMENT_POSITIONS)[number];

  @IsIn(['Left', 'Center', 'Right'])
  alignment: 'Left' | 'Center' | 'Right';

  @IsIn(['Small', 'Medium', 'Full Width'])
  sizeProfile: 'Small' | 'Medium' | 'Full Width';

  /** Report templates only — grid/size display profile. */
  @IsOptional()
  @IsIn(['Full Width', 'Grid 2 per Row', 'Grid 3 per Row', 'Original Size'])
  displayProfile?:
    | 'Full Width'
    | 'Grid 2 per Row'
    | 'Grid 3 per Row'
    | 'Original Size';

  /** SMS only — generate a short link instead of attaching files. */
  @IsOptional()
  @IsBoolean()
  shortLinkGenerator?: boolean;
}
