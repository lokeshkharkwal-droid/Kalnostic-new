import { IsString, IsUUID, MinLength } from 'class-validator';

/**
 * A reflex-test reference accepted on write as `{ id, name }`. The whole object
 * is stored verbatim as a JSON snapshot in `OpdTestResultParam.reflexTests`
 * and returned as-is on read; `id` is the referenced opd test's id and
 * `name` its display label.
 */
export class ReflexTestRefDto {
  /** Id of the referenced opd test. */
  @IsUUID('4')
  id: string;

  /** Display name of the referenced opd test. */
  @IsString()
  @MinLength(1)
  name: string;
}
