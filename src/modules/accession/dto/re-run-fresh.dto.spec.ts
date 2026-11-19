import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ReRunFreshDto } from './re-run-fresh.dto';

/**
 * The repeat reason of "Re-run with a fresh sample" must contain a character a person can SEE. A reason of only spaces or
 * invisible characters (zero-width space, joiners, ...) used to pass (JavaScript's trim does not remove them) and was stored
 * as a reason that LOOKS empty. Bodies go through the SAME ValidationPipe `main.ts` installs globally.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const ID = '11111111-1111-4111-8111-111111111111';
const run = (body: unknown) => pipe.transform(body, { type: 'body', metatype: ReRunFreshDto });
const body = (repeatReason: unknown) => ({ reportIds: [ID], repeatReason });

async function refusedFor(repeatReason: unknown): Promise<string[] | null> {
  const err: unknown = await run(body(repeatReason)).then(
    () => null,
    (e: unknown) => e,
  );
  if (err === null) return null;
  expect(err).toBeInstanceOf(BadRequestException);
  const res = (err as BadRequestException).getResponse() as { message?: string | string[] };
  return Array.isArray(res.message) ? res.message : [String(res.message)];
}

describe('ReRunFreshDto.repeatReason - must contain a visible character', () => {
  it.each([
    ['normal text', 'Clotted'],
    ['one visible letter', 'x'],
    ['a visible letter next to an invisible one', 'x​'],
    ['an emoji', '\u{1F9EA}'],
    ['text with inner and outer spaces', '  Hemolysed sample  '],
    ['exactly 255 characters', 'a'.repeat(255)],
  ])('accepts %s', async (_name, reason) => {
    await expect(run(body(reason))).resolves.toBeDefined();
  });

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['a tab and a newline', '\t\n'],
    ['a zero-width space', '​'],
    ['zero-width space between spaces', '  ​  '],
    ['zero-width joiner and non-joiner', '‍‌'],
    ['a non-breaking space', ' '],
    ['a soft hyphen', '­'],
    ['a byte order mark', '﻿'],
    ['Braille blank', '⠀'],
  ])('refuses %s (400, nothing reaches the service)', async (_name, reason) => {
    const msgs = await refusedFor(reason);
    expect(msgs).not.toBeNull();
    expect(msgs!.join(' ')).toMatch(/repeatReason/);
  });

  it('refuses more than 255 characters', async () => {
    expect(await refusedFor('a'.repeat(256))).not.toBeNull();
  });

  it('refuses a missing reason', async () => {
    expect(await refusedFor(undefined)).not.toBeNull();
  });

  it.each([
    ['an object', { a: 1 }],
    ['an array', ['x']],
    ['a number', 123],
    ['a boolean', true],
  ])('refuses %s as the reason - it must not be turned into text such as "[object Object]"', async (_name, reason) => {
    const msgs = await refusedFor(reason);
    expect(msgs).not.toBeNull();
    expect(msgs!.join(' ')).toMatch(/repeatReason/);
  });

  it('refuses a NUL character in the reason (PostgreSQL cannot store it: it used to be a 500)', async () => {
    const msgs = await refusedFor('abc\u0000def');
    expect(msgs).not.toBeNull();
    expect(msgs!.join(' ')).toMatch(/NUL/);
  });
});

describe('ReRunFreshDto.notes - optional, text only, no NUL character', () => {
  const withNotes = (notes: unknown) => ({ reportIds: [ID], repeatReason: 'Clotted', notes });
  const refusedNotes = async (notes: unknown) => {
    const err: unknown = await run(withNotes(notes)).then(
      () => null,
      (e: unknown) => e,
    );
    if (err === null) return null;
    const res = (err as BadRequestException).getResponse() as { message?: string | string[] };
    return Array.isArray(res.message) ? res.message : [String(res.message)];
  };

  it.each([
    ['no notes at all', undefined],
    ['plain text', 'Sample was haemolysed'],
    ['text with a line break and an emoji', 'line 1\nline 2 \u{1F9EA}'],
    ['a long note', 'n'.repeat(100_000)],
  ])('accepts %s', async (_name, notes) => {
    await expect(run(withNotes(notes))).resolves.toBeDefined();
  });

  it.each([
    ['an object', { a: 1 }],
    ['an array', ['x']],
    ['a number', 5],
  ])('refuses %s (it used to be saved as "[object Object]" / "5")', async (_name, notes) => {
    const msgs = await refusedNotes(notes);
    expect(msgs).not.toBeNull();
    expect(msgs!.join(' ')).toMatch(/notes/);
  });

  it('refuses a NUL character in the notes', async () => {
    const msgs = await refusedNotes('abc\u0000def');
    expect(msgs).not.toBeNull();
    expect(msgs!.join(' ')).toMatch(/NUL/);
  });
});
