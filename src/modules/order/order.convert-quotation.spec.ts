import { QuotationStatus } from '@prisma/client';
import { OrderService } from './order.service';
import {
  QuotationAlreadyConvertedException,
  SourceQuotationInvalidException,
} from './exceptions/order.exceptions';

/**
 * Convert-to-Order flips the source quote to CONVERTED inside the create
 * transaction. The flip is a compare-and-set, so a quote converts exactly once:
 * a second (concurrent or repeated) conversion matches no row and fails, which
 * rolls back the order that request was creating.
 */
/** The shape of the `updateMany` call the code under test makes. */
interface UpdateManyArg {
  where: { quotationStatus: { in: QuotationStatus[] } } & Record<
    string,
    unknown
  >;
  data: Record<string, unknown>;
}

describe('OrderService — markSourceQuotationConvertedInTx', () => {
  const service = new OrderService(
    ...(Array(13).fill(undefined) as ConstructorParameters<
      typeof OrderService
    >),
  );

  const updateMany = jest.fn<Promise<{ count: number }>, [UpdateManyArg]>();
  const findFirst = jest.fn<
    Promise<{ id: string } | null>,
    [{ where?: { quotationStatus?: QuotationStatus } }]
  >();
  const tx = { order: { updateMany, findFirst } };

  const run = () =>
    (
      service as unknown as {
        markSourceQuotationConvertedInTx: (
          tx: unknown,
          tenantId: string,
          sourceQuotationId: string,
          personId: string | null,
        ) => Promise<void>;
      }
    ).markSourceQuotationConvertedInTx(tx, 'tenant-1', 'quote-1', 'person-1');

  beforeEach(() => {
    updateMany.mockReset();
    findFirst.mockReset();
  });

  it('converts a not-yet-converted quote in one guarded update', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(run()).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'quote-1',
        tenantId: 'tenant-1',
        deletedAt: null,
        quotationStatus: {
          in: [QuotationStatus.DRAFT, QuotationStatus.EXPIRED],
        },
      },
      data: {
        quotationStatus: QuotationStatus.CONVERTED,
        updatedBy: 'person-1',
      },
    });
  });

  it('never matches an already-CONVERTED quote (the guard is inside the update itself)', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await run();
    const where = updateMany.mock.calls[0]?.[0].where;
    if (!where) throw new Error('updateMany was not called');
    expect(where.quotationStatus.in).not.toContain(QuotationStatus.CONVERTED);
  });

  it('rejects a second conversion of the same quote with QUOTATION_ALREADY_CONVERTED', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValue({ id: 'quote-1' });
    await expect(run()).rejects.toBeInstanceOf(
      QuotationAlreadyConvertedException,
    );
    const lookup = findFirst.mock.calls[0]?.[0];
    expect(lookup?.where?.quotationStatus).toBe(QuotationStatus.CONVERTED);
  });

  it('rejects a missing / foreign-tenant / non-quote source with SOURCE_QUOTATION_INVALID', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValue(null);
    await expect(run()).rejects.toBeInstanceOf(SourceQuotationInvalidException);
  });

  it('is scoped to the caller tenant and live rows', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await run();
    expect(updateMany.mock.calls[0]?.[0].where).toMatchObject({
      tenantId: 'tenant-1',
      deletedAt: null,
    });
  });
});
