import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { TransferRejectDto } from './transfer-reject.dto';
import { TransferRepeatDto } from './transfer-repeat.dto';
import {
  BulkTransferRejectDto,
  BulkTransferRepeatDto,
} from './bulk-transfer-action.dto';

/**
 * The receiving branch's Reject and Repeat of a transfer must carry a real reason.
 * The screen forces one (a required dropdown), but a direct API call used to be able
 * to send an empty or spaces-only reason and close the transfer with a blank one.
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

/** The 400's messages, flattened to one string for `toContain` checks. */
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
    name: 'TransferRejectDto (Reject)',
    dto: TransferRejectDto,
    field: 'rejectionReason',
    other: 'repeatReason',
    body: (reason: unknown) => ({ rejectionReason: reason }),
  },
  {
    name: 'TransferRepeatDto (Repeat)',
    dto: TransferRepeatDto,
    field: 'repeatReason',
    other: 'rejectionReason',
    body: (reason: unknown) => ({ repeatReason: reason }),
  },
  {
    name: 'BulkTransferRejectDto (group Reject)',
    dto: BulkTransferRejectDto,
    field: 'rejectionReason',
    other: 'repeatReason',
    body: (reason: unknown) => ({ ids: [ID], rejectionReason: reason }),
  },
  {
    name: 'BulkTransferRepeatDto (group Repeat)',
    dto: BulkTransferRepeatDto,
    field: 'repeatReason',
    other: 'rejectionReason',
    body: (reason: unknown) => ({ ids: [ID], repeatReason: reason }),
  },
] as const;

describe.each(CASES)(
  '$name - the reason is mandatory and must have text',
  (c) => {
    it('accepts an ordinary reason unchanged', async () => {
      await expect(
        run(c.dto, c.body('Damaged in Transit')),
      ).resolves.toMatchObject({ [c.field]: 'Damaged in Transit' });
    });

    it('accepts a reason that only has spaces around the text, and keeps it as typed', async () => {
      await expect(
        run(c.dto, c.body('  Wrong Sample Type  ')),
      ).resolves.toMatchObject({ [c.field]: '  Wrong Sample Type  ' });
    });

    it('accepts a one-character reason (the only rule is "has a visible character")', async () => {
      await expect(run(c.dto, c.body('x'))).resolves.toMatchObject({
        [c.field]: 'x',
      });
    });

    it('still accepts the optional notes and attachment alongside the reason', async () => {
      await expect(
        run(c.dto, {
          ...c.body('Insufficient Volume'),
          notes: 'tube was half empty',
          attachmentUrl: 'https://files.example.com/a.png',
        }),
      ).resolves.toMatchObject({ [c.field]: 'Insufficient Volume' });
    });

    it.each([
      ['an empty string', ''],
      ['one space', ' '],
      ['several spaces', '     '],
      ['a tab', '\t'],
      ['a line break', '\n'],
      ['mixed blanks', ' \t\r\n '],
      ['non-breaking and wide spaces', '  '],
    ])('refuses %s (400), naming the field', async (_label, value) => {
      const message = await refusal(c.dto, c.body(value));
      expect(message).toContain(
        `${c.field} must contain at least one non-space character`,
      );
    });

    it('refuses the reason being missing (400)', async () => {
      const body = c.body(undefined);
      delete (body as Record<string, unknown>)[c.field];
      const message = await refusal(c.dto, body);
      expect(message).toContain(c.field);
    });

    it('refuses null (400)', async () => {
      await refusal(c.dto, c.body(null));
    });

    it.each([
      ['an object', { a: 1 }],
      ['an array', ['Damaged']],
      ['a number', 7],
      ['a boolean', true],
    ])(
      'refuses %s instead of saving it as junk text (400)',
      async (_label, value) => {
        const message = await refusal(c.dto, c.body(value));
        expect(message).toContain(c.field);
      },
    );

    it('accepts exactly 255 characters and refuses 256 (400)', async () => {
      await expect(run(c.dto, c.body('x'.repeat(255)))).resolves.toBeDefined();
      const message = await refusal(c.dto, c.body('x'.repeat(256)));
      expect(message).toContain('shorter than or equal to 255');
    });

    it('still refuses unknown properties (400)', async () => {
      await refusal(c.dto, { ...c.body('Damaged in Transit'), isAdmin: true });
    });

    it("does not accept the OTHER action's reason field in place of its own (400)", async () => {
      const body = { ...c.body('Damaged in Transit') } as Record<
        string,
        unknown
      >;
      delete body[c.field];
      body[c.other] = 'Damaged in Transit';
      await refusal(c.dto, body);
    });
  },
);

describe('the group (bulk) variants keep their own rules next to the reason', () => {
  it.each([
    ['BulkTransferRejectDto', BulkTransferRejectDto, 'rejectionReason'],
    ['BulkTransferRepeatDto', BulkTransferRepeatDto, 'repeatReason'],
  ] as const)('%s accepts the skipInvalid flag', async (_name, dto, field) => {
    await expect(
      run(dto, { ids: [ID], [field]: 'Damaged', skipInvalid: true }),
    ).resolves.toMatchObject({ skipInvalid: true, [field]: 'Damaged' });
  });

  it.each([
    ['BulkTransferRejectDto', BulkTransferRejectDto, 'rejectionReason'],
    ['BulkTransferRepeatDto', BulkTransferRepeatDto, 'repeatReason'],
  ] as const)(
    '%s still refuses an empty id list (400)',
    async (_name, dto, field) => {
      await refusal(dto, { ids: [], [field]: 'Damaged' });
    },
  );

  it.each([
    ['BulkTransferRejectDto', BulkTransferRejectDto, 'rejectionReason'],
    ['BulkTransferRepeatDto', BulkTransferRepeatDto, 'repeatReason'],
  ] as const)(
    '%s still refuses an id that is not a UUID (400)',
    async (_name, dto, field) => {
      await refusal(dto, { ids: ['not-a-uuid'], [field]: 'Damaged' });
    },
  );

  it.each([
    ['BulkTransferRejectDto', BulkTransferRejectDto, 'rejectionReason'],
    ['BulkTransferRepeatDto', BulkTransferRepeatDto, 'repeatReason'],
  ] as const)(
    '%s with a blank reason is refused even with skipInvalid set (400)',
    async (_name, dto, field) => {
      const message = await refusal(dto, {
        ids: [ID],
        [field]: '   ',
        skipInvalid: true,
      });
      expect(message).toContain(
        `${field} must contain at least one non-space character`,
      );
    },
  );
});
