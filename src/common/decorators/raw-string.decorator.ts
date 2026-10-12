import { Transform } from 'class-transformer';

/**
 * Keeps a string field's RAW value so `@IsString()` sees what the client sent.
 *
 * Our global ValidationPipe runs with `enableImplicitConversion: true`, which
 * coerces a `string`-typed property with `String(value)` BEFORE any validator
 * runs — so an object body like `{ notes: { a: 1 } }` silently becomes the text
 * "[object Object]" and passes `@IsString()`. Reading the raw value from
 * `obj[key]` sidesteps that coercion, so a non-text value is rejected with a 400
 * instead of being saved as junk. Absent/null values stay as they are, so
 * `@IsOptional()` still applies.
 *
 * @returns a property decorator that resolves the raw (uncoerced) value.
 */
export function RawString(): PropertyDecorator {
  return Transform(({ obj, key }) => (obj as Record<string, unknown>)?.[key]);
}
