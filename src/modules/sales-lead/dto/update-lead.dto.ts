import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateLeadDto } from './create-lead.dto';

/**
 * Partial update of a lead. Inherits every field from {@link CreateLeadDto} and
 * relaxes the six create-required fields to optional (explicit overrides — we do
 * not use `PartialType`). `leadCode`/tenant/branch remain immutable/context-only.
 */
export class UpdateLeadDto extends CreateLeadDto {
  @IsOptional() @IsString() @MaxLength(120) declare category: string;
  @IsOptional() @IsString() @MaxLength(255) declare organizationName: string;
  @IsOptional() @IsString() @MaxLength(120) declare organizationType: string;
  @IsOptional() @IsString() @MaxLength(255) declare primaryContactName: string;
  @IsOptional() @IsString() @MaxLength(20) declare mobile: string;
  @IsOptional() @IsString() @MaxLength(120) declare source: string;
}
