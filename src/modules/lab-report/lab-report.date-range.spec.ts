import { Prisma } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import { ListLabReportsDto } from './dto/list-lab-reports.dto';

/**
 * Technician → Reporting date filter. The list, the status-pill counts and the
 * TAT analytics all build their `where` through `buildListWhere`, so the end day
 * must be covered there: picking a single day used to return nothing because the
 * end bound was 00:00 UTC of that day.
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

  const createdAt = (where: Prisma.LabReportWhereInput) =>
    where.createdAt as { gte?: Date; lt?: Date; lte?: Date } | undefined;

  it('a single day covers that whole day', () => {
    const r = createdAt(
      build({ dateFrom: '2026-10-06', dateTo: '2026-10-06' }),
    );
    expect(r).toEqual({
      gte: new Date('2026-10-06T00:00:00.000Z'),
      lt: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('a report created late on the end day is inside the range', () => {
    const r = createdAt(
      build({ dateFrom: '2026-10-05', dateTo: '2026-10-06' }),
    )!;
    const lateOnEndDay = new Date('2026-10-06T21:15:00.000Z');
    expect(lateOnEndDay >= r.gte! && lateOnEndDay < r.lt!).toBe(true);
  });

  it('a report created on the day after the range is outside it', () => {
    const r = createdAt(
      build({ dateFrom: '2026-10-05', dateTo: '2026-10-06' }),
    )!;
    expect(new Date('2026-10-07T00:00:00.000Z') < r.lt!).toBe(false);
  });

  it('only an end date still includes the whole end day', () => {
    expect(createdAt(build({ dateTo: '2026-10-06' }))).toEqual({
      lt: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('only a start date leaves the end open', () => {
    expect(createdAt(build({ dateFrom: '2026-10-07' }))).toEqual({
      gte: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('adds no date condition when no date is chosen', () => {
    expect(createdAt(build({}))).toBeUndefined();
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
