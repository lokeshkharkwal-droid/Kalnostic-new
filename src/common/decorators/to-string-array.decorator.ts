import { Transform } from 'class-transformer';

/**
 * Parses an optional list query-string param (repeated key or bracket form:
 * `?names=a&names=b` / `?names[]=a&names[]=b`) into a `string[]` from its RAW value.
 *
 * Values are NOT split on commas and NOT trimmed: a value can legitimately contain
 * commas (e.g. the sample name "WB-EDTA (3ml) / CSF (1ml)") and must be matched
 * exactly as stored. A single value arrives as a plain string, so it is wrapped.
 * Empty entries are dropped; returns `undefined` when the param is missing or empty
 * so `@IsOptional` still applies.
 *
 * Reads `obj[key]` (the raw value) because the global ValidationPipe runs with
 * `enableImplicitConversion: true`, which runs before any `@Transform`.
 *
 * @returns a property decorator resolving the raw value to a `string[]`.
 */
export function ToStringArray(): PropertyDecorator {
  return Transform(({ obj, key }) => {
    const raw = (obj as Record<string, unknown>)?.[key];
    if (raw === undefined || raw === null || raw === '') return undefined;
    const list = (Array.isArray(raw) ? raw : [raw])
      .map((v) => (typeof v === 'string' ? v : String(v as number)))
      .filter((v) => v !== '');
    return list.length > 0 ? list : undefined;
  });
}
