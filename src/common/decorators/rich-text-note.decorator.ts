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
 * @param label the field's name as the user sees it, e.g. "Useful For"
 */
export function RichTextNote(label: string): PropertyDecorator {
  return applyDecorators(
    Transform(
      ({ value }: { value: unknown }) =>
        typeof value === 'string' ? sanitizeRichText(value) : value,
      { toClassOnly: true },
    ),
    NoteMaxLength(label),
  );
}
