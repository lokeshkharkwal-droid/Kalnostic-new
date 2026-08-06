import { BranchType } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Payload for `POST /siteadmin/departments` — a SITE_ADMIN global department
 * template (no tenant/branch). Mirrors CreateDepartmentDto but WITHOUT person
 * mappings (templates carry no staff) and without `code` (system-generated
 * `SA-Dep-{n}`, see DepartmentService.createTemplate).
 */
export class CreateDepartmentTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  // User-set short prefix, globally unique among active templates (validated in
  // the service / DB). Optional; if provided must be 2-6 chars starting with an
  // uppercase letter.
  @IsString()
  @IsOptional()
  @Matches(/^[A-Z][a-zA-Z0-9]{1,5}$/, {
    message:
      'shortName must be 2-6 characters starting with an uppercase letter (A-Z)',
  })
  shortName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // "Module mapping" — reuses the same enum as Branch.branchType.
  @IsArray()
  @IsEnum(BranchType, { each: true })
  @ArrayUnique()
  moduleMapping: BranchType[];
}
