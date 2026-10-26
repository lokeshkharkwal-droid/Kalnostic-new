import { Matches, ValidationArguments } from 'class-validator';

/**
 * A character a person can SEE. Whitespace is not one, and neither is anything that
 * draws nothing: control characters, format characters (zero-width space / joiner /
 * non-joiner, word joiner, soft hyphen, BOM, bidi marks ...), the blank "filler"
 * letters (Hangul fillers, Braille blank) and the lone combining grapheme joiner.
 * JavaScript's own `\s` misses most of these, so `/\S/` lets a reason that LOOKS
 * empty (e.g. only zero-width spaces) through.
 */
export const VISIBLE_CHARACTER =
  /[^\s\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\u034F\u115F\u1160\u2800\u3164\uFFA0]/u;

/**
 * The value must contain at least one visible character (see `VISIBLE_CHARACTER`).
 * An empty, spaces-only or invisible-characters-only value is refused with a 400.
 * Non-text values are left to `@IsString()`.
 */
export function HasVisibleText(): PropertyDecorator {
  return Matches(VISIBLE_CHARACTER, {
    message: (args: ValidationArguments) =>
      `${args.property} must contain at least one non-space character`,
  });
}
