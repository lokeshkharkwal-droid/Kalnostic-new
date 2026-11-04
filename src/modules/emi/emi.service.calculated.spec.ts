import { LabAdapter } from '@prisma/client';
import { EmiService } from './emi.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { AdapterLogsService } from '../adapter-logs/adapter-logs.service';
import { SubmitResultBody } from './dto/submit-result.dto';

/**
 * A machine's result must recalculate the report's calculated (formula) parameters.
 *
 * Example: P1 comes from the analyzer, P2 is typed by hand, P3 = P1 * P2 + 500. When the analyzer sends a new P1, the STORED P3
 * has to follow (before the fix only a technician's Save recalculated it, so the report view, print and approval kept showing
 * the old number). The fake database below is stateful so the tests assert what is STORED after the submission.
 *
 * Rules covered: recalculated in the same save; a value the technician took over by hand (stored source MANUAL) is kept; a
 * calculated value the machine itself sent is kept (and still feeds other formulas); a missing input blanks the stored value
 * but never creates an empty row; a test with no calculated parameter costs no extra work; chains evaluate in order.
 */
describe("EmiService.submitResult — calculated parameters follow the machine's values", () => {
  const adapter = {
    id: 'ad1',
    tenantId: 't1',
    token: 'TOK',
    equipmentId: 'eq1',
    isActive: true,
  } as unknown as LabAdapter;

  type Param = {
    id: string;
    parameterName: string;
    parameterCode: string;
    reportingUnit: string | null;
    parameterType: 'MEASURED' | 'CALCULATED';
    calculationFormula: string | null;
    decimalPlaces: number | null;
    resultType: string;
  };
  type Stored = {
    resultParamId: string;
    observed1: string | null;
    source: 'MANUAL' | 'ADAPTER' | 'CALCULATED';
    enteredBy?: string;
    deletedAt: Date | null;
  };

  const measured = (code: string): Param => ({
    id: `prm-${code}`,
    parameterName: code,
    parameterCode: code,
    reportingUnit: null,
    parameterType: 'MEASURED',
    calculationFormula: null,
    decimalPlaces: null,
    resultType: 'QUANTITATIVE',
  });
  const calculated = (code: string, formula: string, dp = 0): Param => ({
    ...measured(code),
    parameterType: 'CALCULATED',
    calculationFormula: formula,
    decimalPlaces: dp,
  });
  const P1 = measured('P1');
  const P2 = measured('P2');
  const P3 = calculated('P3', 'P1 * P2 + 500');

  /** A stateful fake of the Prisma transaction client the EMI service (and the shared recompute) call. */
  function makeTx(opts: {
    params: Param[];
    stored?: Stored[];
    report?: Partial<{
      labTestId: string | null;
      status: string;
      isLocked: boolean;
    }>;
    mappedTest?: string;
    linkedBranch?: string;
  }) {
    const rows: Stored[] = (opts.stored ?? []).map((r) => ({ ...r }));
    const matches = (r: Stored, where: Record<string, unknown>): boolean => {
      if (
        'deletedAt' in where &&
        where.deletedAt === null &&
        r.deletedAt !== null
      )
        return false;
      if ('source' in where && r.source !== where.source) return false;
      const inIds = (where.resultParamId as { in?: string[] } | undefined)?.in;
      if (inIds && !inIds.includes(r.resultParamId)) return false;
      return true;
    };
    const tx = {
      labAdapterBranch: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ branchId: opts.linkedBranch ?? 'br1' }]),
      },
      labAdapterTest: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ branchLabTestId: opts.mappedTest ?? 'blt-x' }]),
      },
      equipment: { findFirst: jest.fn().mockResolvedValue({ code: 'EQ' }) },
      branchLabTest: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'blt-x', testName: 'Calc Test' }]),
      },
      orderSample: {
        findMany: jest.fn().mockResolvedValue([
          {
            orderId: 'ord1',
            branchId: 'br1',
            status: 'ACCEPTED',
            tests: [{ orderItemId: 'oi1', labTestId: 'lt-x' }],
          },
        ]),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'ord1',
          orderCode: 'ORD-1',
          branchId: 'br1',
          status: 'REGISTERED',
          orderDate: new Date('2026-01-01T00:00:00Z'),
          patient: {
            id: 'p1',
            umId: 'UM1',
            firstName: 'John',
            lastName: 'Doe',
            gender: 'MALE',
            dateOfBirth: new Date('1990-01-01T00:00:00Z'),
          },
          referredByDoctor: null,
          items: [
            {
              id: 'oi1',
              branchLabTestId: null,
              branchLabPanelId: 'blp1',
              branchLabTest: null,
              branchLabPanel: { id: 'blp1', panelName: 'Calc Panel' },
              labReports: [
                {
                  id: 'rep1',
                  status: opts.report?.status ?? 'SAVED',
                  isLocked: opts.report?.isLocked ?? false,
                  branchId: 'br1',
                  labTestId:
                    opts.report && 'labTestId' in opts.report
                      ? opts.report.labTestId
                      : 'lt-x',
                  memberBranchLabTestId: 'blt-x',
                },
              ],
            },
          ],
        }),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme Lab' }) },
      labTestResultParam: {
        findMany: jest.fn((args: { where: Record<string, unknown> }) => {
          let list = opts.params;
          if (args.where.OR)
            list = list.filter(
              (p) =>
                p.parameterType === 'CALCULATED' ||
                p.calculationFormula !== null,
            );
          return Promise.resolve(list);
        }),
      },
      branchLabPanelTest: { findMany: jest.fn().mockResolvedValue([]) },
      labTest: { findMany: jest.fn().mockResolvedValue([]) },
      orderSampleTest: { findFirst: jest.fn().mockResolvedValue(null) },
      adapterResult: { create: jest.fn().mockResolvedValue({}) },
      labReportResultValue: {
        findMany: jest.fn((args: { where: Record<string, unknown> }) =>
          Promise.resolve(
            rows.filter((r) => matches(r, args.where)).map((r) => ({ ...r })),
          ),
        ),
        upsert: jest.fn(
          (args: {
            where: { labReportId_resultParamId: { resultParamId: string } };
            create: Record<string, unknown>;
            update: Record<string, unknown>;
          }) => {
            const id = args.where.labReportId_resultParamId.resultParamId;
            const i = rows.findIndex((r) => r.resultParamId === id);
            if (i >= 0)
              rows[i] = { ...rows[i]!, ...(args.update as Partial<Stored>) };
            else
              rows.push({
                ...(args.create as unknown as Omit<Stored, 'deletedAt'>),
                deletedAt: null,
              });
            return Promise.resolve({});
          },
        ),
      },
      labReport: { update: jest.fn().mockResolvedValue({}) },
    };
    return {
      tx,
      rows,
      row: (code: string) =>
        rows.find((r) => r.resultParamId === `prm-${code}`),
    };
  }

  const makeService = (tx: unknown) => {
    const prisma = {
      withTenant: jest.fn((_t: string, cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    return new EmiService(
      prisma,
      {} as unknown as UploadsService,
      { record: jest.fn() } as unknown as AdapterLogsService,
    );
  };
  const send = (
    service: EmiService,
    results: Array<[code: string, value: string]>,
  ) => {
    const body: SubmitResultBody = {
      tube_no: '10001',
      test_results: results.map(([code, value]) => ({
        universal_test_id: code,
        test_result: value,
      })),
    };
    return service.submitResult(adapter, body, null);
  };

  it("the analyzer sends P1 = 50 and P2 = 10 is already stored: P3 is stored as 1000, as a calculated value (not the analyzer's, not manual)", async () => {
    const m = makeTx({
      params: [P1, P2, P3],
      stored: [
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
      ],
    });
    const res = await send(makeService(m.tx), [['P1', '50']]);
    expect(res.test_status).toBe('1 test updated');
    expect(m.row('P1')).toMatchObject({ observed1: '50', source: 'ADAPTER' });
    expect(m.row('P3')).toMatchObject({
      observed1: '1000',
      source: 'CALCULATED',
      enteredBy: 'ad1',
    });
  });

  it('THE REPORTED CASE: P3 is stored as 1000, the analyzer sends a NEW P1 = 20: the stored P3 becomes 700 (not left at 1000)', async () => {
    const m = makeTx({
      params: [P1, P2, P3],
      stored: [
        {
          resultParamId: 'prm-P1',
          observed1: '50',
          source: 'ADAPTER',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P3',
          observed1: '1000',
          source: 'CALCULATED',
          deletedAt: null,
        },
      ],
    });
    await send(makeService(m.tx), [['P1', '20']]);
    expect(m.row('P1')).toMatchObject({ observed1: '20', source: 'ADAPTER' });
    expect(m.row('P3')).toMatchObject({
      observed1: '700',
      source: 'CALCULATED',
    });
    expect(m.row('P2')).toMatchObject({ observed1: '10', source: 'MANUAL' }); // the hand-typed input is untouched
  });

  it("the machine's own response and the report status are exactly as before (a calculation never changes them)", async () => {
    const m = makeTx({
      params: [P1, P2, P3],
      stored: [
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
      ],
    });
    const res = await send(makeService(m.tx), [['P1', '50']]);
    expect(res.s).toBe('200');
    const updates = m.tx.labReport.update.mock.calls as unknown as Array<
      [{ where: { id: string }; data: { status: string } }]
    >;
    expect(updates).toHaveLength(1);
    expect(updates[0]![0].data.status).toBe('SAVED');
  });

  it("the technician took P3 over by hand (stored source MANUAL): the machine's new P1 does NOT change it", async () => {
    const m = makeTx({
      params: [P1, P2, P3],
      stored: [
        {
          resultParamId: 'prm-P1',
          observed1: '50',
          source: 'ADAPTER',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P3',
          observed1: '999',
          source: 'MANUAL',
          deletedAt: null,
        },
      ],
    });
    await send(makeService(m.tx), [['P1', '20']]);
    expect(m.row('P3')).toMatchObject({ observed1: '999', source: 'MANUAL' });
  });

  it("the machine sends P3 ITSELF together with P1: the analyzer's own P3 is kept (source ADAPTER), not replaced by the formula", async () => {
    const m = makeTx({
      params: [P1, P2, P3],
      stored: [
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
      ],
    });
    await send(makeService(m.tx), [
      ['P1', '50'],
      ['P3', '42'],
    ]);
    expect(m.row('P3')).toMatchObject({ observed1: '42', source: 'ADAPTER' });
  });

  it('a calculated value an earlier submission sent (source ADAPTER) and that is not sent now follows its inputs (the formula decides)', async () => {
    const m = makeTx({
      params: [P1, P2, P3],
      stored: [
        {
          resultParamId: 'prm-P1',
          observed1: '50',
          source: 'ADAPTER',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P3',
          observed1: '42',
          source: 'ADAPTER',
          deletedAt: null,
        },
      ],
    });
    await send(makeService(m.tx), [['P1', '20']]);
    expect(m.row('P3')).toMatchObject({
      observed1: '700',
      source: 'CALCULATED',
    });
  });

  it('an input is still missing (P2 not entered): no empty P3 row is created', async () => {
    const m = makeTx({ params: [P1, P2, P3] });
    await send(makeService(m.tx), [['P1', '50']]);
    expect(m.row('P3')).toBeUndefined();
    expect(m.rows.map((r) => r.resultParamId)).toEqual(['prm-P1']);
  });

  it('an input is missing and P3 already has a stored value: it is blanked, not left at the old number', async () => {
    const m = makeTx({
      params: [P1, P2, P3],
      stored: [
        {
          resultParamId: 'prm-P3',
          observed1: '1000',
          source: 'CALCULATED',
          deletedAt: null,
        },
      ],
    });
    await send(makeService(m.tx), [['P1', '50']]); // P2 was never entered
    expect(m.row('P3')).toMatchObject({
      observed1: null,
      source: 'CALCULATED',
    });
  });

  it('a non-numeric reading (e.g. "abc") blanks the calculated value instead of failing the machine\'s submission', async () => {
    const m = makeTx({
      params: [P1, P2, P3],
      stored: [
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P3',
          observed1: '1000',
          source: 'CALCULATED',
          deletedAt: null,
        },
      ],
    });
    const res = await send(makeService(m.tx), [['P1', 'abc']]);
    expect(res.s).toBe('200');
    expect(m.row('P1')).toMatchObject({ observed1: 'abc', source: 'ADAPTER' });
    expect(m.row('P3')).toMatchObject({ observed1: null });
  });

  it('division by zero blanks the calculated value', async () => {
    const ratio = calculated('R', 'P1 / P2', 2);
    const m = makeTx({
      params: [P1, P2, ratio],
      stored: [
        {
          resultParamId: 'prm-P2',
          observed1: '0',
          source: 'MANUAL',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-R',
          observed1: '5.00',
          source: 'CALCULATED',
          deletedAt: null,
        },
      ],
    });
    await send(makeService(m.tx), [['P1', '10']]);
    expect(m.row('R')).toMatchObject({ observed1: null });
  });

  it("the value is written with the parameter's decimal places", async () => {
    const ratio = calculated('R', 'P1 / P2', 2);
    const m = makeTx({
      params: [P1, P2, ratio],
      stored: [
        {
          resultParamId: 'prm-P2',
          observed1: '3',
          source: 'MANUAL',
          deletedAt: null,
        },
      ],
    });
    await send(makeService(m.tx), [['P1', '10']]);
    expect(m.row('R')).toMatchObject({ observed1: '3.33' });
  });

  it('a chain (P4 = P3 * 2, P3 = P1 * P2 + 500) is recalculated in dependency order, whatever order the parameters are listed in', async () => {
    const P4 = calculated('P4', 'P3 * 2');
    const m = makeTx({
      params: [P4, P3, P1, P2], // deliberately listed dependents first
      stored: [
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P3',
          observed1: '1000',
          source: 'CALCULATED',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P4',
          observed1: '2000',
          source: 'CALCULATED',
          deletedAt: null,
        },
      ],
    });
    await send(makeService(m.tx), [['P1', '20']]);
    expect(m.row('P3')).toMatchObject({ observed1: '700' });
    expect(m.row('P4')).toMatchObject({ observed1: '1400' });
  });

  it('a kept calculated value (manual override) still feeds the formulas that use it', async () => {
    const P4 = calculated('P4', 'P3 * 2');
    const m = makeTx({
      params: [P1, P2, P3, P4],
      stored: [
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P3',
          observed1: '999',
          source: 'MANUAL',
          deletedAt: null,
        },
      ],
    });
    await send(makeService(m.tx), [['P1', '20']]);
    expect(m.row('P3')).toMatchObject({ observed1: '999', source: 'MANUAL' });
    expect(m.row('P4')).toMatchObject({
      observed1: '1998',
      source: 'CALCULATED',
    });
  });

  it('a calculated value whose row was soft-deleted (e.g. by a re-run) is brought back with the new number', async () => {
    const m = makeTx({
      params: [P1, P2, P3],
      stored: [
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P3',
          observed1: '1000',
          source: 'CALCULATED',
          deletedAt: new Date(),
        },
      ],
    });
    await send(makeService(m.tx), [['P1', '20']]);
    expect(m.row('P3')).toMatchObject({ observed1: '700', deletedAt: null });
  });

  it("a test with NO calculated parameter costs no extra work: only the machine's own value is written, and nothing else is queried", async () => {
    const m = makeTx({ params: [P1, P2] });
    await send(makeService(m.tx), [['P1', '50']]);
    expect(m.tx.labReportResultValue.upsert).toHaveBeenCalledTimes(1);
    expect(m.tx.labReportResultValue.findMany).not.toHaveBeenCalled();
  });

  it('a machine value that is not an input of any formula changes no calculated value', async () => {
    const P5 = measured('P5');
    const m = makeTx({
      params: [P1, P2, P3, P5],
      stored: [
        {
          resultParamId: 'prm-P1',
          observed1: '50',
          source: 'ADAPTER',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P3',
          observed1: '1000',
          source: 'CALCULATED',
          deletedAt: null,
        },
      ],
    });
    await send(makeService(m.tx), [['P5', '7']]);
    expect(m.row('P3')).toMatchObject({
      observed1: '1000',
      source: 'CALCULATED',
    });
  });

  it('a report that has no lab test attached is filled as before and nothing is recalculated', async () => {
    const m = makeTx({
      params: [P1, P2, P3],
      report: { labTestId: null },
      stored: [
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
      ],
    });
    // with no labTestId the machine's params resolve through the panel members (none here), so nothing matches; it must still not throw
    await expect(
      send(makeService(m.tx), [['P1', '50']]),
    ).resolves.toBeDefined();
    expect(m.row('P3')).toBeUndefined();
  });

  it('a report that is not fillable any more (Approved) is not touched, and nothing is recalculated', async () => {
    const m = makeTx({
      params: [P1, P2, P3],
      report: { status: 'APPROVED' },
      stored: [
        {
          resultParamId: 'prm-P1',
          observed1: '50',
          source: 'ADAPTER',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
        {
          resultParamId: 'prm-P3',
          observed1: '1000',
          source: 'CALCULATED',
          deletedAt: null,
        },
      ],
    });
    await send(makeService(m.tx), [['P1', '20']]);
    expect(m.row('P1')).toMatchObject({ observed1: '50' });
    expect(m.row('P3')).toMatchObject({ observed1: '1000' });
    expect(m.tx.labReportResultValue.upsert).not.toHaveBeenCalled();
  });

  it('sending the same value twice gives the same stored result (idempotent)', async () => {
    const m = makeTx({
      params: [P1, P2, P3],
      stored: [
        {
          resultParamId: 'prm-P2',
          observed1: '10',
          source: 'MANUAL',
          deletedAt: null,
        },
      ],
    });
    const service = makeService(m.tx);
    // The moments written on the rows differ between two submissions; what is stored (value and source) must not.
    const stable = () =>
      m.rows
        .map((r) => `${r.resultParamId}=${String(r.observed1)}/${r.source}`)
        .sort();
    await send(service, [['P1', '20']]);
    const first = stable();
    await send(service, [['P1', '20']]);
    expect(stable()).toEqual(first);
    expect(first).toEqual([
      'prm-P1=20/ADAPTER',
      'prm-P2=10/MANUAL',
      'prm-P3=700/CALCULATED',
    ]);
  });

  describe('edge cases: who may fill, which reports, what is sent', () => {
    const stateWithInputs = () => [
      {
        resultParamId: 'prm-P2',
        observed1: '10',
        source: 'MANUAL' as const,
        deletedAt: null,
      },
      {
        resultParamId: 'prm-P3',
        observed1: '1000',
        source: 'CALCULATED' as const,
        deletedAt: null,
      },
    ];

    it('an adapter that is NOT mapped to this test fills nothing and recalculates nothing', async () => {
      const m = makeTx({
        params: [P1, P2, P3],
        mappedTest: 'blt-other',
        stored: stateWithInputs(),
      });
      await send(makeService(m.tx), [['P1', '20']]);
      expect(m.row('P1')).toBeUndefined();
      expect(m.row('P3')).toMatchObject({ observed1: '1000' });
      expect(m.tx.labReportResultValue.upsert).not.toHaveBeenCalled();
    });

    it("an adapter that is not linked to the report's branch fills nothing and recalculates nothing", async () => {
      const m = makeTx({
        params: [P1, P2, P3],
        linkedBranch: 'br-elsewhere',
        stored: stateWithInputs(),
      });
      await send(makeService(m.tx), [['P1', '20']]);
      expect(m.row('P3')).toMatchObject({ observed1: '1000' });
      expect(m.tx.labReportResultValue.upsert).not.toHaveBeenCalled();
    });

    it('a LOCKED report is not filled and its calculated value is not touched', async () => {
      const m = makeTx({
        params: [P1, P2, P3],
        report: { isLocked: true },
        stored: stateWithInputs(),
      });
      await send(makeService(m.tx), [['P1', '20']]);
      expect(m.row('P1')).toBeUndefined();
      expect(m.row('P3')).toMatchObject({ observed1: '1000' });
      expect(m.tx.labReportResultValue.upsert).not.toHaveBeenCalled();
    });

    it.each(['PENDING', 'PARTIAL_PENDING', 'SAVED'])(
      'a %s report is filled, its calculated value follows, and the report is Saved',
      async (status) => {
        const m = makeTx({
          params: [P1, P2, P3],
          report: { status },
          stored: [
            {
              resultParamId: 'prm-P2',
              observed1: '10',
              source: 'MANUAL',
              deletedAt: null,
            },
          ],
        });
        await send(makeService(m.tx), [['P1', '20']]);
        expect(m.row('P3')).toMatchObject({
          observed1: '700',
          source: 'CALCULATED',
        });
        const updates = m.tx.labReport.update.mock.calls as unknown as Array<
          [{ data: { status: string } }]
        >;
        expect(updates[0]![0].data.status).toBe('SAVED');
      },
    );

    it.each(['VALIDATION_PENDING', 'RESULT_DONE', 'APPROVED', 'PUBLISHED'])(
      'a %s report is not filled and nothing is recalculated',
      async (status) => {
        const m = makeTx({
          params: [P1, P2, P3],
          report: { status },
          stored: stateWithInputs(),
        });
        await send(makeService(m.tx), [['P1', '20']]);
        expect(m.row('P3')).toMatchObject({ observed1: '1000' });
        expect(m.tx.labReportResultValue.upsert).not.toHaveBeenCalled();
      },
    );

    it('values the machine sends that match no parameter of the test change nothing and cost no recalculation', async () => {
      const m = makeTx({ params: [P1, P2, P3], stored: stateWithInputs() });
      await send(makeService(m.tx), [['NOT_A_PARAM', '5']]);
      expect(m.row('P3')).toMatchObject({ observed1: '1000' });
      expect(m.tx.labReportResultValue.upsert).not.toHaveBeenCalled();
      expect(m.tx.labReportResultValue.findMany).not.toHaveBeenCalled();
    });

    it('a submission with no results at all changes nothing', async () => {
      const m = makeTx({ params: [P1, P2, P3], stored: stateWithInputs() });
      await send(makeService(m.tx), []);
      expect(m.row('P3')).toMatchObject({ observed1: '1000' });
      expect(m.tx.labReportResultValue.upsert).not.toHaveBeenCalled();
    });

    it('the same code sent twice in one submission: the formula uses what was stored last', async () => {
      const m = makeTx({
        params: [P1, P2, P3],
        stored: [
          {
            resultParamId: 'prm-P2',
            observed1: '10',
            source: 'MANUAL',
            deletedAt: null,
          },
        ],
      });
      await send(makeService(m.tx), [
        ['P1', '30'],
        ['P1', '20'],
      ]);
      expect(m.row('P1')?.observed1).toBeDefined();
      expect(m.row('P3')?.observed1).toBe(
        String(Number(m.row('P1')!.observed1) * 10 + 500),
      );
    });

    it("a machine sends the unit too: the calculated value does not carry a unit or change the inputs' units", async () => {
      const m = makeTx({
        params: [P1, P2, P3],
        stored: [
          {
            resultParamId: 'prm-P2',
            observed1: '10',
            source: 'MANUAL',
            deletedAt: null,
          },
        ],
      });
      const body: SubmitResultBody = {
        tube_no: '10001',
        test_results: [
          { universal_test_id: 'P1', test_result: '20', unit: 'g/L' },
        ],
      };
      await makeService(m.tx).submitResult(adapter, body, null);
      expect(m.row('P3')).toMatchObject({
        observed1: '700',
        source: 'CALCULATED',
      });
      expect(m.row('P3')).not.toHaveProperty('unit');
    });

    it('a failure while recalculating is NOT swallowed: the submission fails as a whole (in the database it rolls back), so the machine can retry', async () => {
      const m = makeTx({ params: [P1, P2, P3], stored: stateWithInputs() });
      m.tx.labReportResultValue.findMany.mockRejectedValueOnce(
        new Error('connection lost'),
      );
      await expect(send(makeService(m.tx), [['P1', '20']])).rejects.toThrow(
        'connection lost',
      );
    });

    it('sending a value for a parameter that no formula uses, to a test that HAS formulas, recalculates the others to the same numbers (no drift)', async () => {
      const P5 = measured('P5');
      const m = makeTx({
        params: [P1, P2, P3, P5],
        stored: [
          {
            resultParamId: 'prm-P1',
            observed1: '20',
            source: 'ADAPTER',
            deletedAt: null,
          },
          {
            resultParamId: 'prm-P2',
            observed1: '10',
            source: 'MANUAL',
            deletedAt: null,
          },
          {
            resultParamId: 'prm-P3',
            observed1: '700',
            source: 'CALCULATED',
            deletedAt: null,
          },
        ],
      });
      await send(makeService(m.tx), [['P5', '1']]);
      expect(m.row('P3')).toMatchObject({
        observed1: '700',
        source: 'CALCULATED',
      });
    });
  });
});
