import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Class-validator constraint (CLAUDE.md rule #2 — decorators only, no
 * hand-rolled checks): passes when the DTO carries at least one of
 * `branchLabTestListId` / `branchLabPanelListId`. Attached to a mandatory
 * property (`categoryName`) so it always runs — `@IsOptional()` on the mapping
 * fields would short-circuit a constraint placed there when both are absent.
 */
export function AtLeastOneMapping(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'atLeastOneMapping',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const obj = args.object as {
            branchLabTestListId?: string | null;
            branchLabPanelListId?: string | null;
          };
          return (
            Boolean(obj.branchLabTestListId) ||
            Boolean(obj.branchLabPanelListId)
          );
        },
        defaultMessage(): string {
          return 'Select at least one Lab Test List or Lab Panel List';
        },
      },
    });
  };
}

/**
 * Create a PT Category on the caller's active branch (never a client-supplied
 * branch — CLAUDE.md §4.7). Maps to at most one Lab Test List and one Lab Panel
 * List; at least one is required. If `isDefault` is true the branch's previous
 * default is unset in the same transaction.
 */
export class CreatePtCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @AtLeastOneMapping()
  categoryName: string;

  /** A `BranchLabTestList` id (pricing list) mapped to this category. */
  @IsOptional()
  @IsUUID('4')
  branchLabTestListId?: string;

  /** A `BranchLabPanelList` id (pricing list) mapped to this category. */
  @IsOptional()
  @IsUUID('4')
  branchLabPanelListId?: string;

  /** When true, this category becomes the branch's default (replacing any prior default). */
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
