import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Partial update for a PT Category (explicit optionals, not `PartialType`). A
 * mapping field sent as `null` CLEARS that mapping; omitted leaves it unchanged.
 * The service re-checks that at least one mapping remains after the merge (it
 * cannot be a DTO-only rule since the other id may live on the existing row).
 */
export class UpdatePtCategoryDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(100)
  categoryName?: string;

  /** `BranchLabTestList` id, or `null` to clear the mapping. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID('4')
  branchLabTestListId?: string | null;

  /** `BranchLabPanelList` id, or `null` to clear the mapping. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID('4')
  branchLabPanelListId?: string | null;

  /** When true, this category becomes the branch's default (replacing any prior default). */
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
