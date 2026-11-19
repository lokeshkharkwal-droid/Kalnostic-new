import { LabReportStatus, SampleStatus, TransferStatus } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import type { LabReportWorklistRow } from './entities/lab-report.entity';

/**
 * The worklist marks a report "Outsourced – Repeated" (`outsourceSentBack`) when the holder branch's samples are all waiting
 * or outsourced, and every outsourced one has its newest outsource transfer sent back (Repeat / Rejected): the same rule the
 * server uses to refuse writes (`isReportAwaitingSample`), so the screen shows it view-only exactly when a write would fail.
 */
const BRANCH = 'A';

const row = (
  statuses: SampleStatus[],
  over: Partial<LabReportWorklistRow> = {},
): LabReportWorklistRow =>
  ({
    id: 'r1',
    branchId: BRANCH,
    sampleIds: statuses.map((_, i) => `s${i}`),
    sampleStatuses: statuses,
    sampleBranchIds: statuses.map(() => BRANCH),
    sampleBarcodes: statuses.map(() => '10001'),
    outsourceSentBack: false,
    ...over,
  }) as unknown as LabReportWorklistRow;

function build(
  transfers: { sampleId: string; transferStatus: TransferStatus }[],
) {
  const findMany = jest.fn().mockResolvedValue(transfers);
  const svc = Object.create(LabReportService.prototype) as LabReportService;
  Object.assign(svc, { prisma: { sampleTransfer: { findMany } } });
  const attach = (rows: LabReportWorklistRow[]) =>
    (
      svc as unknown as {
        attachOutsourceSentBack: (
          tenantId: string,
          rows: LabReportWorklistRow[],
        ) => Promise<LabReportWorklistRow[]>;
      }
    ).attachOutsourceSentBack('t1', rows);
  return { attach, findMany };
}

describe('attachOutsourceSentBack', () => {
  it.each([TransferStatus.REPEAT, TransferStatus.REJECTED])(
    'an outsourced sample whose newest transfer is %s marks the report',
    async (transferStatus) => {
      const m = build([{ sampleId: 's0', transferStatus }]);
      const [out] = await m.attach([row([SampleStatus.OUTSOURCED])]);
      expect(out!.outsourceSentBack).toBe(true);
    },
  );

  it.each([
    TransferStatus.IN_TRANSIT,
    TransferStatus.PICKED_UP,
    TransferStatus.RECEIVED,
    TransferStatus.ACCEPTED,
  ])(
    'an outsourced sample whose transfer is %s (not sent back) does not',
    async (transferStatus) => {
      const m = build([{ sampleId: 's0', transferStatus }]);
      const [out] = await m.attach([row([SampleStatus.OUTSOURCED])]);
      expect(out!.outsourceSentBack).toBe(false);
    },
  );

  it('asks nothing (and changes nothing) when no sample is outsourced', async () => {
    const m = build([]);
    const rows = [row([SampleStatus.ACCEPTED]), row([SampleStatus.REPEAT])];
    const out = await m.attach(rows);
    expect(m.findMany).not.toHaveBeenCalled();
    expect(out).toBe(rows);
  });

  it('only the newest outsource transfer counts', async () => {
    const m = build([
      { sampleId: 's0', transferStatus: TransferStatus.ACCEPTED },
      { sampleId: 's0', transferStatus: TransferStatus.REPEAT },
    ]);
    const [out] = await m.attach([row([SampleStatus.OUTSOURCED])]);
    expect(out!.outsourceSentBack).toBe(false);
  });

  it.each([
    LabReportStatus.RESULT_DONE,
    LabReportStatus.APPROVED,
    LabReportStatus.PUBLISHED,
    LabReportStatus.ERROR_REPORTED,
  ])(
    'a %s report is not marked: its way forward is Error Reported -> Re-run, so it must not be view-only',
    async (status) => {
      const m = build([
        { sampleId: 's0', transferStatus: TransferStatus.REPEAT },
      ]);
      const [out] = await m.attach([
        row([SampleStatus.OUTSOURCED], { status } as Partial<LabReportWorklistRow>),
      ]);
      expect(out!.outsourceSentBack).toBe(false);
    },
  );

  it.each([
    LabReportStatus.PENDING,
    LabReportStatus.SAVED,
    LabReportStatus.VALIDATION_PENDING,
    LabReportStatus.RESULT_REJECTED,
  ])('a %s report is still marked when its outsourced sample is sent back', async (status) => {
    const m = build([
      { sampleId: 's0', transferStatus: TransferStatus.REPEAT },
    ]);
    const [out] = await m.attach([
      row([SampleStatus.OUTSOURCED], { status } as Partial<LabReportWorklistRow>),
    ]);
    expect(out!.outsourceSentBack).toBe(true);
  });

  it('a test with two containers: sent back + still waiting is marked; sent back + accepted is not', async () => {
    const m = build([
      { sampleId: 's0', transferStatus: TransferStatus.REPEAT },
    ]);
    const [waiting, accepted] = await m.attach([
      row([SampleStatus.OUTSOURCED, SampleStatus.COLLECTED]),
      row([SampleStatus.OUTSOURCED, SampleStatus.ACCEPTED]),
    ]);
    expect(waiting!.outsourceSentBack).toBe(true);
    expect(accepted!.outsourceSentBack).toBe(false);
  });

  it('a sample another branch holds is not this report’s sample', async () => {
    const m = build([
      { sampleId: 's0', transferStatus: TransferStatus.REPEAT },
    ]);
    const [out] = await m.attach([
      row([SampleStatus.OUTSOURCED], { sampleBranchIds: ['B'] }),
    ]);
    expect(out!.outsourceSentBack).toBe(false);
  });

  it('marks only the rows that qualify, in one query for the page', async () => {
    const m = build([
      { sampleId: 's0', transferStatus: TransferStatus.REPEAT },
    ]);
    const rows = [
      row([SampleStatus.OUTSOURCED]),
      row([SampleStatus.ACCEPTED], { id: 'r2' }),
    ];
    const out = await m.attach(rows);
    expect(out.map((r) => r.outsourceSentBack)).toEqual([true, false]);
    expect(m.findMany).toHaveBeenCalledTimes(1);
  });
});
