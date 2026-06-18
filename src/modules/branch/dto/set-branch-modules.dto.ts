import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { SYSTEM_MODULE_KEYS } from '../../permissions/constants/system-modules.constant';

/** Enable/disable a single system module at a branch. */
export class BranchModuleItemDto {
  @IsIn(SYSTEM_MODULE_KEYS)
  moduleKey: string;

  /** Whether the module is enabled at the branch (defaults to true). */
  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}

/**
 * Set which system modules are enabled at a branch (drives module dropdowns and
 * the per-user permission modal). The client sends the full desired set.
 */
export class SetBranchModulesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => BranchModuleItemDto)
  modules: BranchModuleItemDto[];
}
