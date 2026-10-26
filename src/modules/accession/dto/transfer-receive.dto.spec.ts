import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { TransferReceiveDto } from './transfer-receive.dto';
import { BulkReceiveDto } from './bulk-transfer-action.dto';

/**
 * Receiving a transferred sample must record its condition on receipt. The screen
 * forces a choice (a required dropdown), but a direct API call used to be able to
 * send an empty or spaces-only condition and receive the sample with a blank one.
 *
 * Every body goes through the SAME ValidationPipe `main.ts` installs globally,
 * including `enableImplicitConversion`, so what is tested is what the API does.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const run = (metatype: new () => object, body: unknown) =>
  pipe.transform(body, { type: 'body', metatype });

const ID = '11111111-1111-4111-8111-111111111111';

async function refusal(metatype: new () => object, body: unknown) {
  const err: unknown = await run(metatype, body).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BadRequestException);
  return JSON.stringify((err as BadRequestException).getResponse());
}

const CASES = [
  {
    name: 'TransferReceiveDto (Receive)',
    dto: TransferReceiveDto,
    body: (c: unknown) => ({ receiveCondition: c }),
  },
  {
    name: 'BulkReceiveDto (group Receive)',
    dto: BulkReceiveDto,
    body: (c: unknown) => ({ ids: [ID], receiveCondition: c }),
  },
] as const;

describe.each(CASES)(
  '$name - the condition on receipt is mandatory and must have text',
  (c) => {
    it('accepts an ordinary condition unchanged', async () => {
      await expect(run(c.dto, c.body('Satisfactory'))).resolves.toMatchObject({
        receiveCondition: 'Satisfactory',
      });
    });

    it('accepts a condition with spaces around the text, and keeps it as typed', async () => {
      await expect(run(c.dto, c.body('  Hemolyzed  '))).resolves.toMatchObject({
        receiveCondition: '  Hemolyzed  ',
      });
    });

    it('still accepts the optional notes and attachment alongside the condition', async () => {
      await expect(
        run(c.dto, {
          ...c.body('Clotted'),
          notes: 'tube was clotted',
          attachmentUrl: 'https://files.example.com/a.png',
        }),
      ).resolves.toMatchObject({ receiveCondition: 'Clotted' });
    });

    it.each([
      ['an empty string', ''],
      ['one space', ' '],
      ['several spaces', '     '],
      ['a tab', '\t'],
      ['a line break', '\n'],
      ['mixed blanks', ' \t\r\n '],
      ['non-breaking and wide spaces', '\u00A0\u3000'],
      ['a zero-width space', '\u200B'],
      ['several zero-width characters', '\u200B\u200C\u200D\u2060\uFEFF'],
      ['a soft hyphen', '\u00AD'],
      ['a Hangul filler', '\u3164'],
      ['spaces mixed with invisible characters', ' \u200B \t\u2060 '],
    ])('refuses %s (400), naming the field', async (_label, value) => {
      const message = await refusal(c.dto, c.body(value));
      expect(message).toContain(
        'receiveCondition must contain at least one non-space character',
      );
    });

    it('refuses the condition being missing (400)', async () => {
      const body = c.body(undefined) as Record<string, unknown>;
      delete body.receiveCondition;
      expect(await refusal(c.dto, body)).toContain('receiveCondition');
    });

    it('refuses null (400)', async () => {
      await refusal(c.dto, c.body(null));
    });

    it.each([
      ['an object', { a: 1 }],
      ['an array', ['Satisfactory']],
      ['a number', 7],
      ['a boolean', true],
    ])('refuses %s instead of saving it as junk text (400)', async (_l, v) => {
      expect(await refusal(c.dto, c.body(v))).toContain('receiveCondition');
    });

    it('accepts exactly 100 characters and refuses 101 (400)', async () => {
      await expect(run(c.dto, c.body('x'.repeat(100)))).resolves.toBeDefined();
      expect(await refusal(c.dto, c.body('x'.repeat(101)))).toContain(
        'shorter than or equal to 100',
      );
    });

    it('still refuses unknown properties (400)', async () => {
      await refusal(c.dto, { ...c.body('Satisfactory'), isAdmin: true });
    });
  },
);

describe('BulkReceiveDto keeps its own rules next to the condition', () => {
  it('accepts the skipInvalid flag', async () => {
    await expect(
      run(BulkReceiveDto, {
        ids: [ID],
        receiveCondition: 'Satisfactory',
        skipInvalid: true,
      }),
    ).resolves.toMatchObject({ skipInvalid: true });
  });

  it('still refuses an empty id list (400)', async () => {
    await refusal(BulkReceiveDto, {
      ids: [],
      receiveCondition: 'Satisfactory',
    });
  });

  it('refuses a blank condition even with skipInvalid set (400)', async () => {
    await refusal(BulkReceiveDto, {
      ids: [ID],
      receiveCondition: '   ',
      skipInvalid: true,
    });
  });
});
