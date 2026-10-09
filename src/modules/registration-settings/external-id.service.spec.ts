import { ExternalIdFormat, ExternalIdPurpose } from '@prisma/client';
import {
  ExternalIdService,
  MAX_EXTERNAL_ID_SKIPS,
} from './external-id.service';
import { ExternalIdExhaustedException } from './exceptions/registration-settings.exceptions';

/**
 * The auto-generator for an order/quote external id. It bumps a per-branch
 * counter, and because quotes and orders share the `orders` table it must never
 * hand out a number a live record in the branch already holds (e.g. an id typed
 * by hand before the branch switched to an auto format).
 */
const TENANT = 't1';
const BRANCH = 'b1';
const NOW = new Date('2026-10-07T10:00:00');
const FORMAT = ExternalIdFormat.YMD_DAILY;
const ord = (n: number) => `ORD2026/10/07/${String(n).padStart(4, '0')}`;

type Counter = { id: string; counter: number; lastResetAt: Date } | null;

function build(opts: { counter?: Counter; taken?: string[] }) {
  const taken = new Set(opts.taken ?? []);
  const tx = {
    externalIdCounter: {
      findUnique: jest.fn().mockResolvedValue(opts.counter ?? null),
      create: jest
        .fn<Promise<unknown>, [{ data: Record<string, unknown> }]>()
        .mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    order: {
      findFirst: jest.fn(({ where }: { where: { externalOrderId: string } }) =>
        Promise.resolve(taken.has(where.externalOrderId) ? { id: 'x' } : null),
      ),
    },
  };
  const service = new ExternalIdService(
    null as never,
    null as never,
    null as never,
  );
  const gen = (purpose: ExternalIdPurpose = ExternalIdPurpose.ORDER) =>
    service.generateInTx(tx as never, TENANT, BRANCH, purpose, FORMAT, 'BR');
  return { tx, gen };
}

const counterAt = (n: number): Counter => ({
  id: 'c1',
  counter: n,
  lastResetAt: NOW,
});

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});
afterAll(() => jest.useRealTimers());

describe('ExternalIdService.generateInTx - normal numbering is unchanged', () => {
  it('gives the next number and saves it on the counter', async () => {
    const { tx, gen } = build({ counter: counterAt(5) });
    await expect(gen()).resolves.toBe(ord(6));
    expect(tx.externalIdCounter.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { counter: 6, lastResetAt: NOW },
    });
  });

  it('starts at 1 and creates the counter when the branch has none yet', async () => {
    const { tx, gen } = build({});
    await expect(gen()).resolves.toBe(ord(1));
    expect(tx.externalIdCounter.create.mock.calls[0]?.[0]).toMatchObject({
      data: { counter: 1, purpose: ExternalIdPurpose.ORDER },
    });
    expect(tx.externalIdCounter.update).not.toHaveBeenCalled();
  });

  it('restarts at 1 when the daily counter has rolled over', async () => {
    const yesterday = new Date('2026-10-06T10:00:00');
    const { tx, gen } = build({
      counter: { id: 'c1', counter: 41, lastResetAt: yesterday },
    });
    await expect(gen()).resolves.toBe(ord(1));
    expect(tx.externalIdCounter.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { counter: 1, lastResetAt: NOW },
    });
  });

  it('a manual (NONE) format makes no id and touches nothing', async () => {
    const { tx } = build({});
    const service = new ExternalIdService(
      null as never,
      null as never,
      null as never,
    );
    await expect(
      service.generateInTx(
        tx as never,
        TENANT,
        BRANCH,
        ExternalIdPurpose.ORDER,
        ExternalIdFormat.NONE,
        'BR',
      ),
    ).resolves.toBeNull();
    expect(tx.externalIdCounter.findUnique).not.toHaveBeenCalled();
    expect(tx.order.findFirst).not.toHaveBeenCalled();
  });
});

describe('ExternalIdService.generateInTx - skips numbers already in use', () => {
  it('skips one number a record already holds', async () => {
    const { tx, gen } = build({ counter: counterAt(3), taken: [ord(4)] });
    await expect(gen()).resolves.toBe(ord(5));
    expect(tx.externalIdCounter.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { counter: 5, lastResetAt: NOW },
    });
  });

  it('skips a whole run of hand-typed numbers', async () => {
    const { gen } = build({
      counter: counterAt(3),
      taken: [ord(4), ord(5), ord(6)],
    });
    await expect(gen()).resolves.toBe(ord(7));
  });

  it('skips on the very first number of a brand-new counter', async () => {
    const { tx, gen } = build({ taken: [ord(1)] });
    await expect(gen()).resolves.toBe(ord(2));
    expect(tx.externalIdCounter.create.mock.calls[0]?.[0]).toMatchObject({
      data: { counter: 2 },
    });
  });

  it('skips after a rollover too', async () => {
    const yesterday = new Date('2026-10-06T10:00:00');
    const { gen } = build({
      counter: { id: 'c1', counter: 9, lastResetAt: yesterday },
      taken: [ord(1)],
    });
    await expect(gen()).resolves.toBe(ord(2));
  });

  it('a number that only differs by the quote prefix is not a clash', async () => {
    const { gen } = build({
      counter: counterAt(3),
      taken: ['QUO2026/10/07/0004'],
    });
    await expect(gen()).resolves.toBe(ord(4));
  });

  it('quotes are checked as well, with their own prefix', async () => {
    const { gen } = build({
      counter: counterAt(0),
      taken: ['QUO2026/10/07/0001'],
    });
    await expect(gen(ExternalIdPurpose.QUOTATION)).resolves.toBe(
      'QUO2026/10/07/0002',
    );
  });

  it('only looks at live records of this tenant and branch', async () => {
    const { tx, gen } = build({ counter: counterAt(1) });
    await gen();
    expect(tx.order.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT,
        branchId: BRANCH,
        externalOrderId: ord(2),
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  it('gives up with a clear error when every number is taken', async () => {
    const { tx, gen } = build({ counter: counterAt(0) });
    tx.order.findFirst.mockResolvedValue({ id: 'x' });
    await expect(gen()).rejects.toBeInstanceOf(ExternalIdExhaustedException);
    expect(tx.order.findFirst).toHaveBeenCalledTimes(MAX_EXTERNAL_ID_SKIPS + 1);
    expect(tx.externalIdCounter.update).not.toHaveBeenCalled();
    expect(tx.externalIdCounter.create).not.toHaveBeenCalled();
  });
});

describe('ExternalIdService.generateInTx - other kinds of id are not affected', () => {
  it.each([ExternalIdPurpose.APPOINTMENT, ExternalIdPurpose.PATIENT])(
    '%s ids never look in the orders table',
    async (purpose) => {
      const { tx, gen } = build({
        counter: counterAt(2),
        taken: ['APT2026/10/07/0003', 'PAT2026/10/07/0003'],
      });
      await expect(gen(purpose)).resolves.toMatch(/\/0003$/);
      expect(tx.order.findFirst).not.toHaveBeenCalled();
    },
  );
});

/**
 * The greyed "next ID" the Create Quote form shows. It must show the number the
 * record will really get, so it skips ids a live record already holds — exactly
 * like the generator — and it must never fail or reserve anything.
 */
describe('ExternalIdService.previewNext - shows the number that will really be saved', () => {
  const settings = {
    OrderIdConfiguration_AutoIncrementExternalOrderIdFormat: FORMAT,
    Quotation_AutoIncrementExternalQuoteIdFormat: FORMAT,
    Appointment_AutoIncrementExternalAppointmentIdFormat: FORMAT,
    Patients_AutoIncrementExternalPatientIdFormat: FORMAT,
  };
  const quo = (n: number) => `QUO2026/10/07/${String(n).padStart(4, '0')}`;

  function buildPreview(opts: { counter?: Counter; taken?: string[] }) {
    const taken = new Set(opts.taken ?? []);
    const prisma = {
      externalIdCounter: {
        findUnique: jest.fn().mockResolvedValue(opts.counter ?? null),
        create: jest.fn(),
        update: jest.fn(),
      },
      order: {
        findFirst: jest.fn(
          ({ where }: { where: { externalOrderId: string } }) =>
            Promise.resolve(
              taken.has(where.externalOrderId) ? { id: 'x' } : null,
            ),
        ),
      },
    };
    const service = new ExternalIdService(
      prisma as never,
      { findById: jest.fn().mockResolvedValue({ shortName: 'BR' }) } as never,
      { getForBranch: jest.fn().mockResolvedValue(settings) } as never,
    );
    const preview = (
      purpose: ExternalIdPurpose = ExternalIdPurpose.QUOTATION,
    ) => service.previewNext(TENANT, BRANCH, purpose);
    return { prisma, preview };
  }

  it('shows the plain next number when nothing is taken', async () => {
    const { preview } = buildPreview({ counter: counterAt(11) });
    await expect(preview()).resolves.toEqual({
      format: FORMAT,
      value: quo(12),
    });
  });

  it('skips a number a record already holds, so it matches what will be saved', async () => {
    const { preview } = buildPreview({
      counter: counterAt(11),
      taken: [quo(12)],
    });
    await expect(preview()).resolves.toEqual({
      format: FORMAT,
      value: quo(13),
    });
  });

  it('skips a whole run of taken numbers', async () => {
    const { preview } = buildPreview({
      counter: counterAt(11),
      taken: [quo(12), quo(13), quo(14)],
    });
    expect((await preview()).value).toBe(quo(15));
  });

  it('gives exactly the number the generator then hands out', async () => {
    const taken = [quo(12), quo(13)];
    const { preview } = buildPreview({ counter: counterAt(11), taken });
    const shown = (await preview()).value;
    const { gen } = build({ counter: counterAt(11), taken });
    await expect(gen(ExternalIdPurpose.QUOTATION)).resolves.toBe(shown);
  });

  it('never changes the counter (a preview reserves nothing)', async () => {
    const { prisma, preview } = buildPreview({
      counter: counterAt(11),
      taken: [quo(12)],
    });
    await preview();
    expect(prisma.externalIdCounter.create).not.toHaveBeenCalled();
    expect(prisma.externalIdCounter.update).not.toHaveBeenCalled();
  });

  it('starts from 1 on a brand-new counter and still skips taken numbers', async () => {
    const { preview } = buildPreview({ taken: [quo(1)] });
    expect((await preview()).value).toBe(quo(2));
  });

  it('falls back to the plain next number (and never throws) when every number is taken', async () => {
    const { prisma, preview } = buildPreview({ counter: counterAt(0) });
    prisma.order.findFirst.mockResolvedValue({ id: 'x' });
    await expect(preview()).resolves.toEqual({ format: FORMAT, value: quo(1) });
  });

  it('appointment and patient previews never look in the orders table', async () => {
    const { prisma, preview } = buildPreview({ counter: counterAt(2) });
    await preview(ExternalIdPurpose.APPOINTMENT);
    await preview(ExternalIdPurpose.PATIENT);
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('a manual (NONE) format previews nothing', async () => {
    const prisma = {
      externalIdCounter: { findUnique: jest.fn() },
      order: { findFirst: jest.fn() },
    };
    const service = new ExternalIdService(
      prisma as never,
      { findById: jest.fn().mockResolvedValue({ shortName: 'BR' }) } as never,
      {
        getForBranch: jest.fn().mockResolvedValue({
          ...settings,
          Quotation_AutoIncrementExternalQuoteIdFormat: ExternalIdFormat.NONE,
        }),
      } as never,
    );
    await expect(
      service.previewNext(TENANT, BRANCH, ExternalIdPurpose.QUOTATION),
    ).resolves.toEqual({
      format: ExternalIdFormat.NONE,
      value: null,
    });
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });
});
