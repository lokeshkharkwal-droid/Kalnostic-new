import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body for creating a radiology outsource center. `tenantId` and `code` are never
 * accepted from the client — the tenant comes from the JWT and the code is
 * system-generated (ROC-00001…). `radiologyTestId`/`radiologyPanelId` are optional
 * refs to a single active radiology test/panel the center handles.
 * `branchRadiologyTestListId`/`branchRadiologyPanelListId` assign the branch's
 * named Radiology Test List / Panel List, validated against the active branch on
 * the JWT. Unlike the diagnostics outsource center, this model has no contacts.
 */
export class CreateRadiologyOutsourceCenterDto {
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

  // ── Assigned radiology test / panel (single, optional) ──
  @IsUUID()
  @IsOptional()
  radiologyTestId?: string;

  @IsUUID()
  @IsOptional()
  radiologyPanelId?: string;

  // ── Assigned Radiology Test List / Panel List (single, optional; the branch's
  // named pricing lists, validated against the active branch on the JWT) ──
  @IsUUID()
  @IsOptional()
  branchRadiologyTestListId?: string;

  @IsUUID()
  @IsOptional()
  branchRadiologyPanelListId?: string;
}
