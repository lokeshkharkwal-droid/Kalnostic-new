import { Prisma, SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import { ListSamplesDto } from './dto/list-samples.dto';

/**
 * Accession → In-House Orders "Global Search": the same matching as Technician →
 * Reporting's search (patient name in any word order, order id, barcode, test name,
 * panel name, referral panel) plus the Accession-only keys (UHID, Mobile). The Accession
 * No is deliberately NOT searched.
 * It is applied by the shared `buildSampleWhere`, so the summary (tabs + TAT cards) and
 * the list follow it identically — asserted here through `summary`.
 */
describe('OrderSampleService — Global Search', () => {
  const settings = {
    resolve: jest.fn().mockResolvedValue({
      Accession_MaximumTimeToAcceptSampleMinutes: 100,
      Accession_WarningThresholdMinutes: 60,
      Accession_CriticalThresholdMinutes: 30,
    }),
  };
  const groupBy = jest.fn<
    Promise<unknown[]>,
    [{ where: Prisma.OrderSampleWhereInput }]
  >();
  const count = jest.fn<Promise<number>, []>();
  let service: OrderSampleService;

  beforeEach(() => {
    groupBy
      .mockReset()
      .mockResolvedValue([{ status: SampleStatus.NEW, _count: { _all: 1 } }]);
    count.mockReset().mockResolvedValue(0);
    service = new OrderSampleService(
      { orderSample: { groupBy, count } } as never,
      settings as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      { resolveDepartmentIds: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
    );
  });

  const whereFor = async (query: Partial<ListSamplesDto>) => {
    await service.summary('t1', 'b1', 'p1', query);
    return groupBy.mock.calls[0]![0].where;
  };
  /** The whole filter as text, so a clause can be looked for without caring where it sits. */
  const textOf = (w: Prisma.OrderSampleWhereInput) => JSON.stringify(w);

  it('adds no search clause for a blank or whitespace-only search', async () => {
    for (const search of [undefined, '', '   ']) {
      groupBy.mockClear();
      const text = textOf(await whereFor({ search }));
      expect(text).not.toContain('accessionNo');
    }
  });

  it('matches every Technician key and the Accession-only keys, but not the Accession No', async () => {
    const text = textOf(await whereFor({ search: 'abc' }));
    // The Accession No is not a search key
    expect(text).not.toContain('accessionNo');
    // Accession-only keys
    expect(text).toContain('"umId":{"contains":"abc"');
    expect(text).toContain('"mobile":{"contains":"abc"');
    // shared with Technician Reporting
    expect(text).toContain('"barcode":{"contains":"abc"');
    expect(text).toContain('"orderCode":{"contains":"abc"');
    expect(text).toContain('"firstName":{"contains":"abc"');
    expect(text).toContain('"middleName":{"contains":"abc"');
    expect(text).toContain('"lastName":{"contains":"abc"');
    expect(text).toContain('"name":{"contains":"abc"'); // referral panel
    expect(text).toContain('"testName":{"contains":"abc"'); // the sample's test + the ordered test
    expect(text).toContain('"panelName":{"contains":"abc"');
    expect(text).toContain('"mode":"insensitive"');
  });

  it("searches the referral panel through the order, and the test / panel through the sample's tests", async () => {
    const where = await whereFor({ search: 'abc' });
    const or = (where.AND as Prisma.OrderSampleWhereInput[]).find((c) => c.OR)!
      .OR as Prisma.OrderSampleWhereInput[];
    const order = or.find((c) => c.order)!.order as {
      is: { OR: Array<Record<string, unknown>> };
    };
    expect(order.is.OR.some((c) => 'referralPanel' in c)).toBe(true);
    const tests = or.find((c) => c.tests)!.tests as {
      some: { deletedAt: null };
    };
    expect(tests.some.deletedAt).toBeNull();
  });

  it('finds a full name: every word must be found across first / middle / last name', async () => {
    const text = textOf(await whereFor({ search: 'Manish kumar' }));
    // one AND group per word, each an OR across the three name fields
    const groups = text.match(/"AND":\[(\{"OR":\[[^\]]*\]\},?)+\]/g) ?? [];
    expect(groups.length).toBeGreaterThan(0);
    expect(text).toContain('"firstName":{"contains":"Manish"');
    expect(text).toContain('"firstName":{"contains":"kumar"');
    expect(text).toContain('"lastName":{"contains":"kumar"');
    // the whole string is NOT required to sit inside a single name field any more
    expect(text).not.toContain('"firstName":{"contains":"Manish kumar"');
  });

  it('is trimmed before matching', async () => {
    const text = textOf(await whereFor({ search: '   10609  ' }));
    expect(text).toContain('"barcode":{"contains":"10609"');
    expect(text).not.toContain('"contains":"   10609');
  });

  it('matches % _ and \\ as typed (they are escaped, so "%" does not match everything)', async () => {
    const text = textOf(await whereFor({ search: '50%_x\\y' }));
    // JSON-stringified backslash is doubled: \\ in the JSON text is one real backslash
    expect(text).toContain('"contains":"50\\\\%\\\\_x\\\\\\\\y"');
    expect(text).not.toContain('"contains":"50%_x');
  });
});
