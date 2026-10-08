import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  ActionNotesDto,
  RequiredActionNotesDto,
} from './notes-attachments.dto';

/**
 * Runs the bodies through the SAME pipe `main.ts` installs globally. Its
 * `enableImplicitConversion` used to turn `{ notes: { a: 1 } }` into the text
 * "[object Object]" before `@IsString()` ran, so junk was accepted and saved.
 */
describe('notes DTOs — a non-text reason is rejected, not saved as "[object Object]"', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const run = (metatype: new () => object, body: unknown) =>
    pipe.transform(body, { type: 'body', metatype });

  describe('ActionNotesDto (Lock, Delta Check, Critical Alert, …)', () => {
    it('accepts ordinary text unchanged', async () => {
      await expect(
        run(ActionNotesDto, { notes: 'sample clotted' }),
      ).resolves.toMatchObject({
        notes: 'sample clotted',
      });
    });

    it('accepts the notes being absent (reason is optional)', async () => {
      await expect(run(ActionNotesDto, {})).resolves.toBeDefined();
    });

    it('accepts null (optional)', async () => {
      await expect(run(ActionNotesDto, { notes: null })).resolves.toBeDefined();
    });

    it.each([
      ['an object', { a: 1 }],
      ['an array', ['x']],
      ['a number', 42],
      ['a boolean', true],
    ])('rejects %s with a 400', async (_label, value) => {
      await expect(
        run(ActionNotesDto, { notes: value }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('still rejects unknown properties (unchanged behaviour)', async () => {
      await expect(
        run(ActionNotesDto, { notes: 'x', extra: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('RequiredActionNotesDto (Reject, Error Reported)', () => {
    it('accepts ordinary text', async () => {
      await expect(
        run(RequiredActionNotesDto, { notes: 'bad sample' }),
      ).resolves.toMatchObject({
        notes: 'bad sample',
      });
    });

    it.each([
      ['empty text', ''],
      ['missing', undefined],
      ['an object', { a: 1 }],
      ['a number', 7],
    ])('rejects %s', async (_label, value) => {
      await expect(
        run(RequiredActionNotesDto, { notes: value }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
