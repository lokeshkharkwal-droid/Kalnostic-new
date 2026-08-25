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
 * and the code is system-generated. `labTestId`/`labPanelId` are legacy refs to
 * a single active lab test/panel (still used by order-routing eligibility).
 * `branchLabTestListId`/`branchLabPanelListId` assign the branch's named Lab
 * Test List / Lab Panel List, validated against the active branch on the JWT.
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
  @IsOptional()
  @MaxLength(255)
  country?: string;

  @IsString()
  @IsOptional()
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

  // ── Assigned lab test / lab panel (single, optional; legacy — retained for
  // order-routing eligibility, no longer set by the Outsource Center form) ──
  @IsUUID()
  @IsOptional()
  labTestId?: string;

  @IsUUID()
  @IsOptional()
  labPanelId?: string;

  // ── Assigned Lab Test List / Lab Panel List (single, optional; the branch's
  // named pricing lists, validated against the active branch on the JWT) ──
  @IsUUID()
  @IsOptional()
  branchLabTestListId?: string;

  @IsUUID()
  @IsOptional()
  branchLabPanelListId?: string;

  // ── Contacts (up to five, all optional) ──
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OutsourceCenterContactDto)
  contacts?: OutsourceCenterContactDto[];
}
