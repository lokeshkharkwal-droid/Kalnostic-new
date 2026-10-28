import { LabReportService } from './lab-report.service';

/**
 * "Returned by receiving branch" flag on a worklist row: the holder branch's own
 * sample is still Sent and the receiving branch has sent it back (its transfer is
 * closed as REPEAT / REJECTED). The screen words the view-only tag from it.
 */
interface Row {
  id: string;
  branchId: string | null;
  sampleIds: string[];
  sampleStatuses: string[];
  sampleBranchIds: (string | null)[];
}

const A = 'branch-A';
const B = 'branch-B';

function build(transfers: Array<Record<string, unknown>>) {
  const sampleTransfer = { findMany: jest.fn().mockResolvedValue(transfers) };
  const deps = Array(11).fill(undefined) as unknown[];
  deps[0] = { sampleTransfer };
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );
  const run = (rows: Row[]) =>
    (
      service as unknown as {
        attachReturnedByReceiver: (
          tenantId: string,
          rows: Row[],
        ) => Promise<Array<Row & { returnedByReceiver: unknown }>>;
      }
    ).attachReturnedByReceiver('t1', rows);
  return { run, sampleTransfer };
}

const repeated = (sampleId: string) => ({
  sampleId,
  kind: 'INTERNAL',
  transferStatus: 'REPEAT',
  rejectionReason: null,
  repeatReason: 'clotted',
});

describe('LabReportService.attachReturnedByReceiver', () => {
  it('flags a report whose holder sample is Sent and was sent back, with the reason', async () => {
    const { run } = build([repeated('s1')]);
    const [row] = await run([
      {
        id: 'r1',
        branchId: A,
        sampleIds: ['s1'],
        sampleStatuses: ['SENT_INTERNAL'],
        sampleBranchIds: [A],
      },
    ]);
    expect(row!.returnedByReceiver).toEqual({
      kind: 'REPEAT',
      reason: 'clotted',
    });
  });

  it('a Rejected return is flagged as REJECTED', async () => {
    const { run } = build([
      {
        sampleId: 's1',
        kind: 'INTERNAL',
        transferStatus: 'REJECTED',
        rejectionReason: 'hemolysed',
        repeatReason: null,
      },
    ]);
    const [row] = await run([
      {
        id: 'r1',
        branchId: A,
        sampleIds: ['s1'],
        sampleStatuses: ['SENT_INTERNAL'],
        sampleBranchIds: [A],
      },
    ]);
    expect(row!.returnedByReceiver).toEqual({
      kind: 'REJECTED',
      reason: 'hemolysed',
    });
  });

  it('only the HOLDER branch’s own Sent sample counts (the other branch’s sample is ignored)', async () => {
    const { run, sampleTransfer } = build([repeated('sB')]);
    // the report is held by B; the only Sent sample belongs to A
    const [row] = await run([
      {
        id: 'r1',
        branchId: B,
        sampleIds: ['sA', 'sB'],
        sampleStatuses: ['SENT_INTERNAL', 'ACCEPTED'],
        sampleBranchIds: [A, B],
      },
    ]);
    // no sample of the holder is Sent, so nothing is even looked up
    expect(sampleTransfer.findMany).not.toHaveBeenCalled();
    expect(row!.returnedByReceiver ?? null).toBeNull();
  });

  it('a Sent sample whose transfer is still open (not sent back) is not flagged', async () => {
    const { run } = build([]);
    const [row] = await run([
      {
        id: 'r1',
        branchId: A,
        sampleIds: ['s1'],
        sampleStatuses: ['SENT_INTERNAL'],
        sampleBranchIds: [A],
      },
    ]);
    expect(row!.returnedByReceiver ?? null).toBeNull();
  });

  it('no Sent sample on the page: no query at all', async () => {
    const { run, sampleTransfer } = build([]);
    await run([
      {
        id: 'r1',
        branchId: A,
        sampleIds: ['s1'],
        sampleStatuses: ['ACCEPTED'],
        sampleBranchIds: [A],
      },
    ]);
    expect(sampleTransfer.findMany).not.toHaveBeenCalled();
  });
});
