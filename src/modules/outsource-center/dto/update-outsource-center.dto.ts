import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OutsourceCenterContactDto } from './outsource-center-contact.dto';
import { OutsourceCenterBranchAssignmentDto } from './outsource-center-branch-assignment.dto';

/**
 * Body for updating an outsource center. All fields are optional (explicit, not
 * PartialType). `code` is immutable and never accepted. `contacts` and
 * `assignments` are replace-all when present and left unchanged when absent — so
 * unchecking a branch is expressed by omitting it from the `assignments` array.
 * When `assignments` is present it must still be non-empty (a center cannot be
 * left with no branch).
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

  // ── Contacts (replace-all when present) ──
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OutsourceCenterContactDto)
  contacts?: OutsourceCenterContactDto[];

  // ── Branch assignments (replace-all when present; must stay non-empty) ──
  @IsArray()
  @IsOptional()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OutsourceCenterBranchAssignmentDto)
  assignments?: OutsourceCenterBranchAssignmentDto[];
}
