import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OutsourceCenterContactDto } from './outsource-center-contact.dto';

/**
 * Body for updating an outsource center. All fields are optional (explicit, not
 * PartialType). `code` is immutable and never accepted. `contacts` are replace-all
 * when present and left unchanged when absent. `labTestId` / `labPanelId` are
 * validated to be active lab tests/panels in the tenant when present.
 */
export class UpdateOutsourceCenterDto {
  // ── Basic details ──
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  shortName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  address?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  city?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  state?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  pincode?: string;

  // ── Legal & financial ──
  @IsString()
  @IsOptional()
  @MaxLength(50)
  gstNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  panNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  accountHolderName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  bankName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  bankAccountNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  ifscCode?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  isNablAccredited?: boolean;

  // ── Assigned lab test / lab panel (single, optional) ──
  @IsUUID()
  @IsOptional()
  labTestId?: string;

  @IsUUID()
  @IsOptional()
  labPanelId?: string;

  // ── Contacts (replace-all when present) ──
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OutsourceCenterContactDto)
  contacts?: OutsourceCenterContactDto[];
}
