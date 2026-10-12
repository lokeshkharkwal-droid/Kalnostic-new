import { Prisma } from '@prisma/client';
import { LabReportService, applyB2bLabReportScope } from './lab-report.service';
import { ListLabReportsDto } from './dto/list-lab-reports.dto';

/**
 * Technician → Reporting date filter. It compares the ORDER's date
 * (`orderItem.order.orderDate`, a date-only column) — the date the worklist row
 * shows, and the one the Accession worklist filters on — NOT the report's own
 * `createdAt`, which is stamped when the sample is accepted (an order from the
 * 5th accepted on the 7th used to appear under a 6–9 filter).
 *
 * The list, the status-pill counts and the TAT analytics all build their `where`
 * through `buildListWhere`, so the rule lives there.
 */
describe('LabReportService — date range filter', () => {
  const deps = Array(11).fill(undefined) as unknown[];
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );

  const build = (filters: Partial<ListLabReportsDto>) =>
    (
      service as unknown as {
        buildListWhere: (
          tenantId: string,
          branchId: string,
          f: ListLabReportsDto,
          scopeIds: string[],
        ) => Prisma.LabReportWhereInput;
      }
    ).buildListWhere('t1', 'b1', filters, []);

  const orderOf = (where: Prisma.LabReportWhereInput) => where.orderItem?.order;

  const orderDate = (where: Prisma.LabReportWhereInput) =>
    orderOf(where)?.orderDate as { gte?: Date; lte?: Date } | undefined;

  it('filters on the order date, inclusive on both ends', () => {
    expect(
      orderDate(build({ dateFrom: '2026-10-06', dateTo: '2026-10-09' })),
    ).toEqual({
      gte: new Date('2026-10-06T00:00:00.000Z'),
      lte: new Date('2026-10-09T00:00:00.000Z'),
    });
  });

  it('a single day matches exactly that day', () => {
    expect(
      orderDate(build({ dateFrom: '2026-10-06', dateTo: '2026-10-06' })),
    ).toEqual({
      gte: new Date('2026-10-06T00:00:00.000Z'),
      lte: new Date('2026-10-06T00:00:00.000Z'),
    });
  });

  it('does NOT filter on the report’s own createdAt any more', () => {
    const where = build({ dateFrom: '2026-10-06', dateTo: '2026-10-09' });
    expect(where.createdAt).toBeUndefined();
  });

  it('an order dated before the range is outside it, the first and last days are inside', () => {
    const r = orderDate(
      build({ dateFrom: '2026-10-06', dateTo: '2026-10-09' }),
    )!;
    const inRange = (d: string) =>
      new Date(`${d}T00:00:00.000Z`) >= r.gte! &&
      new Date(`${d}T00:00:00.000Z`) <= r.lte!;
    expect(inRange('2026-10-05')).toBe(false);
    expect(inRange('2026-10-06')).toBe(true);
    expect(inRange('2026-10-09')).toBe(true);
    expect(inRange('2026-10-10')).toBe(false);
  });

  it('only an end date leaves the start open', () => {
    expect(orderDate(build({ dateTo: '2026-10-06' }))).toEqual({
      lte: new Date('2026-10-06T00:00:00.000Z'),
    });
  });

  it('only a start date leaves the end open', () => {
    expect(orderDate(build({ dateFrom: '2026-10-07' }))).toEqual({
      gte: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('uses the calendar day as written, never shifted by a time zone', () => {
    expect(
      orderDate(
        build({
          dateFrom: '2026-10-06T00:00:00.000Z',
          dateTo: '2026-10-09T23:59:59.999Z',
        }),
      ),
    ).toEqual({
      gte: new Date('2026-10-06T00:00:00.000Z'),
      lte: new Date('2026-10-09T00:00:00.000Z'),
    });
  });

  it('adds no order condition when no date and no other order filter is chosen', () => {
    const where = build({});
    expect(orderOf(where)).toBeUndefined();
    expect(where.createdAt).toBeUndefined();
  });

  it('shares one order condition with the other order-level filters', () => {
    const order = orderOf(
      build({
        dateFrom: '2026-10-06',
        dateTo: '2026-10-09',
        referredByDoctorId: 'doc-1',
        patientId: 'pat-1',
      }),
    );
    expect(order).toMatchObject({
      referredByDoctorId: 'doc-1',
      patientId: 'pat-1',
      orderDate: {
        gte: new Date('2026-10-06T00:00:00.000Z'),
        lte: new Date('2026-10-09T00:00:00.000Z'),
      },
    });
  });

  it('the B2B referral-panel scope adds to the order condition without dropping the date', () => {
    const where = build({ dateFrom: '2026-10-06', dateTo: '2026-10-09' });
    applyB2bLabReportScope(where, 'panel-1');
    expect(orderOf(where)).toMatchObject({
      referralPanelId: 'panel-1',
      orderDate: {
        gte: new Date('2026-10-06T00:00:00.000Z'),
        lte: new Date('2026-10-09T00:00:00.000Z'),
      },
    });
  });

  it('keeps the tenant, branch and live-rows scope', () => {
    expect(
      build({ dateFrom: '2026-10-06', dateTo: '2026-10-06' }),
    ).toMatchObject({
      tenantId: 't1',
      branchId: 'b1',
      deletedAt: null,
    });
  });
});
