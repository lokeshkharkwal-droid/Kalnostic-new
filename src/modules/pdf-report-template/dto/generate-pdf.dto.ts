import { Type } from 'class-transformer';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * A single signing authority, expanded into `<signing_authority_tag>` blocks in
 * the footer at render time.
 */
export class SigningAuthorityDto {
  /** Signatory display name. */
  @IsString()
  @MaxLength(255)
  name: string;

  /** Role/qualification shown under the name (e.g. "MD, Pathologist"). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  designation?: string;

  /** Council/registration number, if shown. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  registrationNumber?: string;

  /** Signature image as a URL or data URI. */
  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  signatureImage?: string;
}

/**
 * Render context for generating a PDF from a stored template. Decoupled from the
 * lab-result models (not yet wired), so a caller (or a preview UI) supplies the
 * data to interpolate:
 *  - `variables` → single-brace `{placeholder}` substitutions.
 *  - `images` → id → src map for `{{image:ID}}` placeholders.
 *  - `sections` → named row-sets for repeating sections in the body
 *    (e.g. `{ "results": [ { "test_name": "...", "value": "..." }, … ] }`).
 *  - `signatories` → expanded into footer `<signing_authority_tag>` blocks.
 */
export class GeneratePdfDto {
  /** Flat `{placeholder}` values (stringified at render time). */
  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  /** `{{image:ID}}` sources, keyed by id (URL or data URI). */
  @IsOptional()
  @IsObject()
  images?: Record<string, string>;

  /** Named repeating-section row-sets referenced by the body HTML. */
  @IsOptional()
  @IsObject()
  sections?: Record<string, Array<Record<string, unknown>>>;

  /** Signatories for footer `<signing_authority_tag>` blocks. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SigningAuthorityDto)
  signatories?: SigningAuthorityDto[];
}
