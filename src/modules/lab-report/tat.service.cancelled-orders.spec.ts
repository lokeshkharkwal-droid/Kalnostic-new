import { TatService } from './tat.service';

/**
 * `summarize` aggregates exactly the reports it is handed — the caller
 * (`LabReportService.getTatSummary`) decides which: the Approved tab's set, with
 * cancelled orders left out (covered in `lab-report.tat-summary.spec.ts`).
 */
describe('TatService.summarize', () => {
  const groupBy = jest.fn().mockResolvedValue([]);
  const aggregate = jest
    .fn()
    .mockResolvedValue({ _count: { _all: 0 }, _avg: { tatNetMinutes: null } });
  const prisma = { labReport: { groupBy, aggregate } };
  const service = new TatService(prisma as never);

  it('applies the given selection to both the band group-by and the average', async () => {
    const where = { tenantId: 't1', branchId: 'A' };
    await service.summarize(where);
    expect((groupBy.mock.calls[0] as [{ where: unknown }])[0].where).toBe(
      where,
    );
    expect((aggregate.mock.calls[0] as [{ where: unknown }])[0].where).toBe(
      where,
    );
  });
});
