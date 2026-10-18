import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ForwardSampleDto } from './forward-sample.dto';
import { AssignCenterDto } from './assign-center.dto';
import { OutsourceStatusDto } from './outsource-status.dto';
import { BulkForwardDto } from './bulk-transfer-action.dto';

/**
 * A partner lab name (Forward, Assign Center) and the outsource status text must
 * contain a visible character. The screens already force it (Confirm stays disabled
 * for a blank value), but a direct API call used to be able to forward to a blank
 * partner or blank the status.
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

const BLANKS: Array<[string, unknown]> = [
  ['empty', ''],
  ['spaces only', '     '],
  ['tabs and new lines', ' \t\n '],
  ['zero-width spaces only', '​​'],
  ['a number', 123],
  ['an object', { name: 'x' }],
];

const CASES = [
  {
    name: 'ForwardSampleDto (Forward)',
    type: ForwardSampleDto as new () => object,
    field: 'externalPartnerName',
    body: (v: unknown) => ({ externalPartnerName: v }),
    ok: { externalPartnerName: 'Pathkind - Gurgaon' },
  },
  {
    name: 'BulkForwardDto (bulk Forward)',
    type: BulkForwardDto as new () => object,
    field: 'externalPartnerName',
    body: (v: unknown) => ({ ids: [ID], externalPartnerName: v }),
    ok: { ids: [ID], externalPartnerName: 'Pathkind - Gurgaon' },
  },
  {
    name: 'AssignCenterDto (Assign Center, partner name)',
    type: AssignCenterDto as new () => object,
    field: 'externalPartnerName',
    body: (v: unknown) => ({ externalPartnerName: v }),
    ok: { externalPartnerName: 'Pathkind - Gurgaon' },
  },
  {
    name: 'OutsourceStatusDto (Outsource status)',
    type: OutsourceStatusDto as new () => object,
    field: 'outsourceStatus',
    body: (v: unknown) => ({ outsourceStatus: v }),
    ok: { outsourceStatus: 'Results Ready' },
  },
];

describe.each(CASES)('$name needs a visible value', (c) => {
  it.each(BLANKS)(
    'refuses %s with a 400 naming the field',
    async (_label, v) => {
      expect(await refusal(c.type, c.body(v))).toContain(c.field);
    },
  );

  it('accepts a real value', async () => {
    await expect(run(c.type, c.ok)).resolves.toBeDefined();
  });
});

describe('AssignCenterDto: the partner name stays optional', () => {
  it('accepts a body without it (an outsource / internal assignment)', async () => {
    await expect(
      run(AssignCenterDto, { outsourceCenterId: ID }),
    ).resolves.toBeDefined();
  });
});
