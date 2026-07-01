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
 * Body for creating an outsource center together with its contacts. `tenantId`
 * and `code` are never accepted from the client — the tenant comes from the JWT
 * and the code is system-generated. A single lab test and lab panel may be
 * assigned (`labTestId` / `labPanelId`), each validated to be an active lab
 * test/panel in the tenant.
 */
export class CreateOutsourceCenterDto {
  // ── Basic details ──
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  shortName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  address?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  city: string;

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

  // ── Contacts (up to five, all optional) ──
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OutsourceCenterContactDto)
  contacts?: OutsourceCenterContactDto[];
}
