import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { sanitizeRichText } from '../utils/sanitize-rich-text.util';
import { NoteMaxLength } from '../validators/note-max-length.validator';

/**
 * Decorator for a field that carries a rich-text note (the Notes editor's HTML): the value is CLEANED of anything
 * active (scripts, event handlers, `javascript:` links, iframes …) as the request body is turned into the DTO, and
 * then held to the shared length limit. Use it on every such field instead of `NoteMaxLength` alone.
 *
 * The cleaning runs before validation, so the limit applies to what will actually be stored. A value that is not a
 * string is left for `@IsString()` to reject. It runs only when a request body becomes a DTO, not when a DTO is
 * written back out.
 *
 * By default a number, boolean or object is first turned into text by the request pipe's implicit conversion
 * (`enableImplicitConversion`, see `main.ts`), so `5` becomes "5" and `{a:1}` becomes "[object Object]". That is how
 * every text field in the app behaves and the Master Data import relies on it. A field that must NEVER store such
 * text (a note printed on a patient's report) passes `{ strict: true }`: the cleaner then looks at the value exactly
 * as it was sent, a non-string stays a non-string, and `@IsString()` rejects it with a 400.
 *
 * @param label the field's name as the user sees it, e.g. "Useful For"
 * @param options `strict`: reject anything that is not already text instead of converting it
 */
export function RichTextNote(
  label: string,
  options: { strict?: boolean } = {},
): PropertyDecorator {
  return applyDecorators(
    Transform(
      ({
        value,
        obj,
        key,
      }: {
        value: unknown;
        obj: Record<string, unknown>;
        key: string;
      }) => {
        const sent = options.strict ? obj[key] : value;
        return typeof sent === 'string' ? sanitizeRichText(sent) : sent;
      },
      { toClassOnly: true },
    ),
    NoteMaxLength(label),
  );
}
