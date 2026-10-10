import { SampleStatus, TransferKind } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';

/**
 * Accepting an INTERNAL transfer creates the receiving branch's own copy of the
 * sample. The copy must carry the sender's `sampleName` (and type/container), or
 * the receiving branch's label / report print shows a blank sample name.
 */
describe('SampleTransferService — accept clone keeps the sample name', () => {
  const source = {
    id: 'os-src',
    orderId: 'order-1',
    labTestId: 'lt-1',
    labTestSampleId: 'lts-1',
    departmentId: 'dep-1',
    sampleName: 'Fasting blood',
    sampleType: 'Blood',
    containerType: 'EDTA_TUBE_PURPLE_TOP',
    sampleGroupLabel: 'Fasting blood',
    priority: 'ROUTINE',
    originBranchId: 'b-origin',
    branchId: 'b-origin',
    tests: [
      {
        orderItemId: 'item-1',
        labTestId: 'lt-1',
        testName: 'Glucose',
      },
    ],
  };

  const run = async (sampleName: string | null) => {
    const create = jest.fn().mockResolvedValue({ id: 'os-copy' });
    const tx = {
      orderSample: {
        findFirst: jest.fn().mockResolvedValue({ ...source, sampleName }),
        create,
      },
      tenant: {
        update: jest.fn().mockResolvedValue({ accessionCounter: 12 }),
      },
    };
    const samples = {
      ensureLabReportsForAcceptedSample: jest.fn().mockResolvedValue(undefined),
      rehomeLabReportsForSample: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SampleTransferService(
      undefined as never,
      samples as never,
      undefined as never,
      undefined as never,
    );

    const clonedId = await (
      service as unknown as {
        cloneIntoDestination: (
          tx: unknown,
          tenantId: string,
          personId: string | null,
          transfer: {
            id: string;
            kind: TransferKind;
            sampleId: string;
            destinationBranchId: string | null;
            receiveCondition: string | null;
          },
        ) => Promise<string | null>;
      }
    ).cloneIntoDestination(tx, 't1', 'p1', {
      id: 'tr-1',
      kind: TransferKind.INTERNAL,
      sampleId: 'os-src',
      destinationBranchId: 'b-dest',
      receiveCondition: null,
    });

    const data = (
      create.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>
    )[0]![0].data;
    return { clonedId, data };
  };

  it("copies the sender's sample name onto the receiving branch's copy", async () => {
    const { clonedId, data } = await run('Fasting blood');

    expect(clonedId).toBe('os-copy');
    expect(data).toMatchObject({
      branchId: 'b-dest',
      accessionNo: 'ACC-00012',
      status: SampleStatus.ACCEPTED,
      sampleName: 'Fasting blood',
      sampleType: 'Blood',
      sampleGroupLabel: 'Fasting blood',
    });
  });

  it('keeps a null name null (no invented value)', async () => {
    const { data } = await run(null);

    expect(data).toMatchObject({ sampleName: null, sampleType: 'Blood' });
  });
});
