import { PaymentEntryType } from '@prisma/client';
import { OrderService } from './order.service';
import type { BillingRecordRow } from './entities/order.entity';

/**
 * Finance → Reports detailed records carry the person each report holds
 * responsible (order creator / collector / refunder / canceller) both as a name
 * (`responsibleUser`) and as that person's id (`responsibleUserId`). The FE's
 * Userwise PDF groups by the id, so the two must always describe the SAME actor.
 */
describe('OrderService — Finance record responsible user id', () => {
  const findMany = jest.fn();
  const deps = Array(16).fill(undefined) as unknown[];
  deps[0] = { person: { findMany } };
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );
  const enrich = (report: string, rows: BillingRecordRow[]) =>
    (
      service as unknown as {
        enrichReportRows: (
          report: string,
          rows: BillingRecordRow[],
          timezone: string | null,
        ) => Promise<void>;
      }
    ).enrichReportRows(report, rows, 'Asia/Kolkata');

  const PEOPLE: Record<string, string> = {
    'p-creator': 'Anand Kumar',
    'p-collector': 'Kiran Rao',
    'p-editor': 'Meena Shah',
    'p-refunder': 'Ravi Teja',
  };

  /** A record row with only the fields `enrichReportRows` reads. */
  const row = (over: Partial<Record<string, unknown>> = {}) =>
    ({
      createdBy: 'p-creator',
      updatedBy: 'p-editor',
      payments: [],
      orderDate: new Date('2026-11-01T00:00:00Z'),
      orderTime: null,
      createdAt: new Date('2026-11-01T05:30:00Z'),
      ...over,
    }) as unknown as BillingRecordRow;

  beforeEach(() => {
    findMany
      .mockReset()
      .mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in
            .filter((id) => PEOPLE[id])
            .map((id) => {
              const [firstName, lastName] = PEOPLE[id]!.split(' ');
              return { id, firstName, middleName: null, lastName };
            }),
        ),
      );
  });

  it.each(['billing', 'outstanding'])(
    '%s: the order creator',
    async (report) => {
      const r = row();
      await enrich(report, [r]);
      expect(r.responsibleUserId).toBe('p-creator');
      expect(r.responsibleUser).toBe('Anand Kumar');
    },
  );

  it('collection: the payment collector, else the order creator', async () => {
    const collected = row({ paymentCollectedById: 'p-collector' });
    const uncaptured = row({ paymentCollectedById: null });
    await enrich('collection', [collected, uncaptured]);
    expect(collected.responsibleUserId).toBe('p-collector');
    expect(collected.responsibleUser).toBe('Kiran Rao');
    expect(uncaptured.responsibleUserId).toBe('p-creator');
    expect(uncaptured.responsibleUser).toBe('Anand Kumar');
    // "Order Created By" stays the creator either way.
    expect(collected.orderCreatedByName).toBe('Anand Kumar');
  });

  it('refund: the latest REFUND entry with an actor, else the last editor', async () => {
    const refunded = row({
      payments: [
        { entryType: PaymentEntryType.PAYMENT, collectedBy: 'p-collector' },
        { entryType: PaymentEntryType.REFUND, collectedBy: 'p-refunder' },
        { entryType: PaymentEntryType.REFUND, collectedBy: null },
      ],
    });
    const viaUpdate = row({
      payments: [{ entryType: PaymentEntryType.REFUND, collectedBy: null }],
    });
    await enrich('refund', [refunded, viaUpdate]);
    expect(refunded.responsibleUserId).toBe('p-refunder');
    expect(refunded.responsibleUser).toBe('Ravi Teja');
    expect(viaUpdate.responsibleUserId).toBe('p-editor');
    expect(viaUpdate.responsibleUser).toBe('Meena Shah');
  });

  it('cancel: the last editor', async () => {
    const r = row();
    await enrich('cancel', [r]);
    expect(r.responsibleUserId).toBe('p-editor');
    expect(r.responsibleUser).toBe('Meena Shah');
  });

  it('keeps an unresolvable actor id (name null) and nulls both when no actor exists', async () => {
    const unknownPerson = row({ updatedBy: 'p-deleted' });
    const noActor = row({ updatedBy: null });
    await enrich('cancel', [unknownPerson, noActor]);
    expect(unknownPerson.responsibleUserId).toBe('p-deleted');
    expect(unknownPerson.responsibleUser).toBeNull();
    expect(noActor.responsibleUserId).toBeNull();
    expect(noActor.responsibleUser).toBeNull();
  });
});
