import { IsObject } from 'class-validator';

/**
 * Save the Create-Order form field visibility for the active branch. `config`
 * is a free-form `{ section: { field: boolean } }` map managed by the
 * frontend's "Customize Fields" drawer (a `false` value hides the field). The
 * whole map is replaced on each save.
 */
export class SaveOrderFieldConfigDto {
  @IsObject()
  config: Record<string, Record<string, boolean>>;
}
