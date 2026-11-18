import { Transform } from 'class-transformer';

/**
 * Keeps a boolean body field's RAW value so `@IsBoolean()` sees what the client sent.
 *
 * Our global ValidationPipe runs with `enableImplicitConversion: true`, which coerces a
 * `boolean`-typed property with `Boolean(value)` BEFORE any validator runs - so the text
 * "false" (or "no", "0") silently becomes `true` and passes `@IsBoolean()`: a client that
 * sent `"isRecoverable": "false"` would have its sample stored as recoverable. Reading the
 * raw value from `obj[key]` sidesteps that coercion, so only a real JSON `true` / `false`
 * is accepted and anything else is refused with a 400. Absent values stay as they are, so
 * `@IsOptional()` still applies.
 *
 * Use it for JSON BODY booleans. For query-string booleans (which arrive as text) use
 * `ToBoolean()` instead.
 *
 * @returns a property decorator that resolves the raw (uncoerced) value.
 */
export function RawBoolean(): PropertyDecorator {
  return Transform(({ obj, key }) => (obj as Record<string, unknown>)?.[key]);
}
