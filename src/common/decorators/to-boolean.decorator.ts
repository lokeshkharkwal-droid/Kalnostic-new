import { Transform } from 'class-transformer';

/**
 * Parses an optional boolean query-string param from its RAW value.
 *
 * Query params arrive as strings ("true"/"false"). Our global ValidationPipe
 * runs with `enableImplicitConversion: true`, which coerces a Boolean-typed
 * property with `Boolean(value)` BEFORE any `@Transform` runs — turning the
 * string "false" into `true`. Reading the raw value from `obj[key]` sidesteps
 * that coercion. Returns `undefined` when the param is absent so `@IsOptional`
 * still applies.
 *
 * @returns a property decorator that resolves the raw value to a boolean (or
 *   `undefined` when the param is missing/empty).
 */
export function ToBoolean(): PropertyDecorator {
  return Transform(({ obj, key }) => {
    const raw = (obj as Record<string, unknown>)?.[key];
    if (raw === undefined || raw === null || raw === '') return undefined;
    return raw === true || raw === 'true' || raw === '1';
  });
}
