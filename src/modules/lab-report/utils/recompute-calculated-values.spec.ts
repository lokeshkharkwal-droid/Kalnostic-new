import { Prisma } from '@prisma/client';
import {
  recomputeAfterMachineValues,
  recomputeCalculatedValues,
} from './recompute-calculated-values';

/**
 * The shared recalculation of a report's calculated (formula) parameters: used by a technician's Save / Submit (with the list of
 * values the technician overrode) and by a machine's result (which keeps manual overrides and values the machine itself sent).
 * A stateful fake of the transaction client lets every test assert what ends up STORED.
 */
describe('recompute-calculated-values', () => {
  type Param = {
    deletedAt?: Date | null;
    id: string;
    parameterCode: string;
    parameterType: 'MEASURED' | 'CALCULATED';
    resultType: string;
    calculationFormula: string | null;
    decimalPlaces: number | null;
  };
  type Row = {
    resultParamId: string;
    observed1: string | null;
    source: 'MANUAL' | 'ADAPTER' | 'CALCULATED';
    enteredBy?: string;
    enteredAt?: Date;
    deletedAt: Date | null;
  };

  const measured = (code: string): Param => ({
    id: `prm-${code}`,
    parameterCode: code,
    parameterType: 'MEASURED',
    resultType: 'QUANTITATIVE',
    calculationFormula: null,
    decimalPlaces: null,
  });
  const calc = (
    code: string,
    formula: string | null,
    dp: number | null = 0,
  ): Param => ({
    ...measured(code),
    parameterType: 'CALCULATED',
    calculationFormula: formula,
    decimalPlaces: dp,
  });
  const NOW = new Date('2026-11-02T10:00:00.000Z');

  function makeTx(params: Param[], stored: Row[] = []) {
    const rows = stored.map((r) => ({ ...r }));
    const tx = {
      labTestResultParam: {
        findMany: jest.fn((args: { where: { OR?: unknown } }) =>
          Promise.resolve(
            (args.where.OR
              ? params.filter(
                  (p) =>
                    p.parameterType === 'CALCULATED' ||
                    p.calculationFormula !== null,
                )
              : params
            ).filter((p: Param) => !p.deletedAt),
          ),
        ),
      },
      labReportResultValue: {
        findMany: jest.fn(
          (args: {
            where: {
              deletedAt?: null;
              source?: string;
              resultParamId?: { in: string[] };
            };
          }) =>
            Promise.resolve(
              rows
                .filter(
                  (r) =>
                    (args.where.deletedAt === null
                      ? r.deletedAt === null
                      : true) &&
                    (args.where.source
                      ? r.source === args.where.source
                      : true) &&
                    (args.where.resultParamId
                      ? args.where.resultParamId.in.includes(r.resultParamId)
                      : true),
                )
                .map((r) => ({ ...r })),
            ),
        ),
        upsert: jest.fn(
          (args: {
            where: { labReportId_resultParamId: { resultParamId: string } };
            create: Partial<Row>;
            update: Partial<Row>;
          }) => {
            const id = args.where.labReportId_resultParamId.resultParamId;
            const i = rows.findIndex((r) => r.resultParamId === id);
            if (i >= 0) rows[i] = { ...rows[i]!, ...args.update };
            else
              rows.push({
                ...(args.create as Omit<Row, 'deletedAt'>),
                deletedAt: null,
              });
            return Promise.resolve({});
          },
        ),
      },
    };
    return {
      tx: tx as unknown as Prisma.TransactionClient,
      raw: tx,
      rows,
      row: (code: string) =>
        rows.find((r) => r.resultParamId === `prm-${code}`),
    };
  }
  const stored = (
    code: string,
    observed1: string | null,
    source: Row['source'] = 'MANUAL',
  ): Row => ({
    resultParamId: `prm-${code}`,
    observed1,
    source,
    deletedAt: null,
  });
  const run = (
    m: ReturnType<typeof makeTx>,
    keep: string[] = [],
    actor = 'user-1',
  ) =>
    recomputeCalculatedValues(
      m.tx,
      'rep1',
      't1',
      'lt1',
      new Set(keep),
      actor,
      NOW,
    );

  describe("recomputeCalculatedValues (a technician's Save)", () => {
    it('derives the calculated value from the stored inputs and stamps who / when, marked as calculated', async () => {
      const m = makeTx(
        [measured('P1'), measured('P2'), calc('P3', 'P1 * P2 + 500')],
        [stored('P1', '50'), stored('P2', '10')],
      );
      await run(m);
      expect(m.row('P3')).toMatchObject({
        observed1: '1000',
        source: 'CALCULATED',
        enteredBy: 'user-1',
        enteredAt: NOW,
        deletedAt: null,
      });
    });

    it('a changed input gives a new value (50 -> 20 makes 700)', async () => {
      const m = makeTx(
        [measured('P1'), measured('P2'), calc('P3', 'P1 * P2 + 500')],
        [
          stored('P1', '20'),
          stored('P2', '10'),
          stored('P3', '1000', 'CALCULATED'),
        ],
      );
      await run(m);
      expect(m.row('P3')).toMatchObject({
        observed1: '700',
        source: 'CALCULATED',
      });
    });

    it('a value the technician overrode is left exactly as stored, and still feeds the formulas that use it', async () => {
      const m = makeTx(
        [measured('P1'), calc('P3', 'P1 * 2'), calc('P4', 'P3 + 1')],
        [
          stored('P1', '5'),
          stored('P3', '999'),
          stored('P4', null, 'CALCULATED'),
        ],
      );
      await run(m, ['prm-P3']);
      expect(m.row('P3')).toMatchObject({ observed1: '999', source: 'MANUAL' });
      expect(m.row('P4')).toMatchObject({
        observed1: '1000',
        source: 'CALCULATED',
      });
    });

    it('chains are evaluated dependencies first, whatever order the parameters are listed in', async () => {
      const m = makeTx(
        [
          calc('C2', 'C1 * 2'),
          calc('C1', 'A + B'),
          measured('A'),
          measured('B'),
        ],
        [stored('A', '1'), stored('B', '2')],
      );
      await run(m);
      expect(m.row('C1')).toMatchObject({ observed1: '3' });
      expect(m.row('C2')).toMatchObject({ observed1: '6' });
    });

    it('the decimal places of the parameter are used (default 2 when none is set)', async () => {
      const m = makeTx(
        [measured('A'), calc('R1', 'A / 3', 1), calc('R2', 'A / 3', null)],
        [stored('A', '10')],
      );
      await run(m);
      expect(m.row('R1')).toMatchObject({ observed1: '3.3' });
      expect(m.row('R2')).toMatchObject({ observed1: '3.33' });
    });

    it('an input that is blank, not a number or zero in a division blanks an existing value and never creates an empty row', async () => {
      const m = makeTx(
        [
          measured('A'),
          measured('B'),
          calc('R', 'A / B', 2),
          calc('S', 'A * B', 2),
        ],
        [
          stored('A', '10'),
          stored('B', '0'),
          stored('R', '5.00', 'CALCULATED'),
        ],
      );
      await run(m);
      expect(m.row('R')).toMatchObject({ observed1: null }); // division by zero, the row existed
      expect(m.row('S')).toMatchObject({ observed1: '0.00' }); // 10 * 0 is a real number
      const m2 = makeTx(
        [measured('A'), measured('B'), calc('S', 'A * B', 2)],
        [stored('A', 'abc'), stored('B', '2')],
      );
      await run(m2);
      expect(m2.row('S')).toBeUndefined(); // non-numeric input and the row never existed: no empty row
    });

    it('a soft-deleted calculated row is brought back', async () => {
      const m = makeTx(
        [measured('A'), calc('S', 'A + 1')],
        [
          stored('A', '1'),
          { ...stored('S', '9', 'CALCULATED'), deletedAt: new Date() },
        ],
      );
      await run(m);
      expect(m.row('S')).toMatchObject({ observed1: '2', deletedAt: null });
    });

    it('a circular formula changes nothing and does not fail the save', async () => {
      const m = makeTx(
        [calc('X', 'Y + 1'), calc('Y', 'X + 1')],
        [stored('X', '1', 'CALCULATED')],
      );
      await expect(run(m)).resolves.toBeUndefined();
      expect(m.raw.labReportResultValue.upsert).not.toHaveBeenCalled();
    });

    it('a calculated parameter with no formula is skipped; measured parameters are never written', async () => {
      const m = makeTx(
        [measured('A'), calc('S', null), calc('T', 'A + 1')],
        [stored('A', '4')],
      );
      await run(m);
      expect(m.row('S')).toBeUndefined();
      expect(m.row('A')).toMatchObject({ observed1: '4', source: 'MANUAL' });
      expect(m.row('T')).toMatchObject({ observed1: '5' });
    });

    it('a test with nothing calculated asks the database for the parameters only, and writes nothing', async () => {
      const m = makeTx([measured('A'), measured('B')], [stored('A', '1')]);
      await run(m);
      expect(m.raw.labReportResultValue.findMany).not.toHaveBeenCalled();
      expect(m.raw.labReportResultValue.upsert).not.toHaveBeenCalled();
    });

    it('running it twice gives the same stored values', async () => {
      const m = makeTx([measured('A'), calc('S', 'A * 2')], [stored('A', '3')]);
      await run(m);
      const first = m.rows
        .map((r) => `${r.resultParamId}=${String(r.observed1)}`)
        .sort();
      await run(m);
      expect(
        m.rows.map((r) => `${r.resultParamId}=${String(r.observed1)}`).sort(),
      ).toEqual(first);
    });
  });

  describe("recomputeAfterMachineValues (a machine's result)", () => {
    const after = (m: ReturnType<typeof makeTx>, sent: string[]) =>
      recomputeAfterMachineValues(m.tx, {
        labReportId: 'rep1',
        tenantId: 't1',
        labTestId: 'lt1',
        adapterId: 'ad1',
        sentParamIds: new Set(sent),
        now: NOW,
      });

    it("recalculates what the machine's values feed, recording the analyzer as the one who wrote it", async () => {
      const m = makeTx(
        [measured('P1'), measured('P2'), calc('P3', 'P1 * P2 + 500')],
        [
          stored('P1', '20', 'ADAPTER'),
          stored('P2', '10'),
          stored('P3', '1000', 'CALCULATED'),
        ],
      );
      await after(m, ['prm-P1']);
      expect(m.row('P3')).toMatchObject({
        observed1: '700',
        source: 'CALCULATED',
        enteredBy: 'ad1',
        enteredAt: NOW,
      });
    });

    it('a value stored as manual (the technician took it over) is kept; a value the machine sent in this submission is kept', async () => {
      const m = makeTx(
        [measured('P1'), calc('P3', 'P1 * 2'), calc('P4', 'P1 * 3')],
        [
          stored('P1', '5', 'ADAPTER'),
          stored('P3', '999', 'MANUAL'),
          stored('P4', '42', 'ADAPTER'),
        ],
      );
      await after(m, ['prm-P1', 'prm-P4']);
      expect(m.row('P3')).toMatchObject({ observed1: '999', source: 'MANUAL' });
      expect(m.row('P4')).toMatchObject({ observed1: '42', source: 'ADAPTER' });
    });

    it('a calculated value an earlier submission sent and that is not sent now follows its inputs', async () => {
      const m = makeTx(
        [measured('P1'), calc('P3', 'P1 * 2')],
        [stored('P1', '5', 'ADAPTER'), stored('P3', '42', 'ADAPTER')],
      );
      await after(m, ['prm-P1']);
      expect(m.row('P3')).toMatchObject({
        observed1: '10',
        source: 'CALCULATED',
      });
    });

    it('a MANUAL value of a parameter that is NOT calculated does not stop anything', async () => {
      const m = makeTx(
        [measured('P1'), measured('P2'), calc('P3', 'P1 + P2')],
        [stored('P1', '1', 'ADAPTER'), stored('P2', '2', 'MANUAL')],
      );
      await after(m, ['prm-P1']);
      expect(m.row('P3')).toMatchObject({
        observed1: '3',
        source: 'CALCULATED',
      });
    });

    it('a test with nothing calculated costs ONE query (the parameters) and writes nothing', async () => {
      const m = makeTx(
        [measured('P1'), measured('P2')],
        [stored('P1', '1', 'ADAPTER')],
      );
      await after(m, ['prm-P1']);
      expect(m.raw.labTestResultParam.findMany).toHaveBeenCalledTimes(1);
      expect(m.raw.labReportResultValue.findMany).not.toHaveBeenCalled();
      expect(m.raw.labReportResultValue.upsert).not.toHaveBeenCalled();
    });

    it('an input that is still missing creates no empty calculated row', async () => {
      const m = makeTx(
        [measured('P1'), measured('P2'), calc('P3', 'P1 * P2')],
        [stored('P1', '4', 'ADAPTER')],
      );
      await after(m, ['prm-P1']);
      expect(m.row('P3')).toBeUndefined();
    });
  });

  describe('edge cases: readings, deleted rows, unknown references', () => {
    const readingGives = async (reading: string, expected: string | null) => {
      const m = makeTx(
        [measured('A'), calc('R', 'A + 1', 2)],
        [stored('A', reading), stored('R', '9.99', 'CALCULATED')],
      );
      await run(m);
      expect(m.row('R')?.observed1).toBe(expected);
    };
    it.each([
      ['5', '6.00'],
      [' 5 ', '6.00'],
      ['5.', '6.00'],
      ['.5', '1.50'],
      ['+5', '6.00'],
      ['-5', '-4.00'],
      ['1e1', '11.00'],
      ['0x10', '17.00'],
    ])('a reading of %j is a number: the result is %j', readingGives);
    it.each([
      [''],
      ['   '],
      ['abc'],
      ['1,5'],
      ['5 mg'],
      ['<5'],
      ['Infinity'],
      ['NaN'],
    ])(
      'a reading of %j is not a number: an existing calculated value is blanked',
      (reading) => readingGives(reading, null),
    );

    it('an input row that was soft-deleted (a re-run) counts as missing: the calculated value is blanked', async () => {
      const m = makeTx(
        [measured('A'), measured('B'), calc('R', 'A * B')],
        [
          stored('A', '2'),
          { ...stored('B', '3'), deletedAt: new Date() },
          stored('R', '6', 'CALCULATED'),
        ],
      );
      await run(m);
      expect(m.row('R')).toMatchObject({ observed1: null });
    });

    it('a calculated PARAMETER that was removed from the test is never computed or written', async () => {
      const m = makeTx(
        [measured('A'), { ...calc('R', 'A + 1'), deletedAt: new Date() }],
        [stored('A', '2')],
      );
      await run(m);
      expect(m.raw.labReportResultValue.upsert).not.toHaveBeenCalled();
    });

    it('a formula that names a parameter the test does not have is blanked; the other calculated values are still computed', async () => {
      const m = makeTx(
        [measured('A'), calc('R', 'A * GONE'), calc('S', 'A + 1')],
        [stored('A', '2'), stored('R', '5', 'CALCULATED')],
      );
      await run(m);
      expect(m.row('R')).toMatchObject({ observed1: null });
      expect(m.row('S')).toMatchObject({ observed1: '3' });
    });

    it('decimal places are limited to 0-6', async () => {
      const m = makeTx(
        [measured('A'), calc('R1', 'A / 3', 9), calc('R2', 'A / 3', -3)],
        [stored('A', '1')],
      );
      await run(m);
      expect(m.row('R1')?.observed1).toBe('0.333333');
      expect(m.row('R2')?.observed1).toBe('0');
    });

    it('a calculated parameter whose result type is semi-quantitative or qualitative is still computed', async () => {
      const m = makeTx(
        [
          measured('A'),
          { ...calc('R', 'A * 2'), resultType: 'SEMI_QUANTITATIVE' },
        ],
        [stored('A', '4')],
      );
      await run(m);
      expect(m.row('R')).toMatchObject({
        observed1: '8',
        source: 'CALCULATED',
      });
    });

    it('a SEMI-QUANTITATIVE input with a numeric reading feeds a formula on the backend', async () => {
      const m = makeTx(
        [
          measured('A'),
          { ...measured('S'), resultType: 'SEMI_QUANTITATIVE' },
          calc('R', 'A * S'),
        ],
        [stored('A', '2'), stored('S', '3')],
      );
      await run(m);
      expect(m.row('R')).toMatchObject({ observed1: '6' });
    });

    it('a deep chain (10 levels, listed dependents first) is computed in one pass', async () => {
      const params: Param[] = [measured('A')];
      for (let i = 1; i <= 10; i++)
        params.push(calc(`C${i}`, `${i === 1 ? 'A' : `C${i - 1}`} + 1`));
      const m = makeTx(params.reverse(), [stored('A', '1')]);
      await run(m);
      expect(m.row('C10')).toMatchObject({ observed1: '11' });
    });

    it('two calculated values that are independent: keeping one does not stop the other', async () => {
      const m = makeTx(
        [measured('A'), calc('R1', 'A * 2'), calc('R2', 'A * 3')],
        [
          stored('A', '5'),
          stored('R1', '777'),
          stored('R2', '0', 'CALCULATED'),
        ],
      );
      await run(m, ['prm-R1']);
      expect(m.row('R1')).toMatchObject({ observed1: '777' });
      expect(m.row('R2')).toMatchObject({ observed1: '15' });
    });

    it('a list of kept ids that names a parameter that is not calculated, or does not exist, is harmless', async () => {
      const m = makeTx([measured('A'), calc('R', 'A + 1')], [stored('A', '1')]);
      await run(m, ['prm-A', 'prm-NOPE']);
      expect(m.row('R')).toMatchObject({ observed1: '2' });
      expect(m.row('A')).toMatchObject({ observed1: '1', source: 'MANUAL' });
    });

    it('a formula that refers to its own parameter does not hang or fail (such a formula is refused when it is configured)', async () => {
      const m = makeTx([calc('X', 'X + 1')], [stored('X', '1', 'CALCULATED')]);
      await expect(run(m)).resolves.toBeUndefined();
    });

    it('the time and the person written are the ones given, on every row it writes', async () => {
      const m = makeTx(
        [measured('A'), calc('R1', 'A + 1'), calc('R2', 'A + 2')],
        [stored('A', '1')],
      );
      await run(m, [], 'someone');
      for (const code of ['R1', 'R2'])
        expect(m.row(code)).toMatchObject({
          enteredBy: 'someone',
          enteredAt: NOW,
        });
    });
  });

  describe('recomputeAfterMachineValues — edge cases', () => {
    const after = (m: ReturnType<typeof makeTx>, sent: string[]) =>
      recomputeAfterMachineValues(m.tx, {
        labReportId: 'rep1',
        tenantId: 't1',
        labTestId: 'lt1',
        adapterId: 'ad1',
        sentParamIds: new Set(sent),
        now: NOW,
      });

    it('a MANUAL value that was soft-deleted (a re-run) is no longer an override: the value comes back from the formula', async () => {
      const m = makeTx(
        [measured('P1'), calc('P3', 'P1 * 2')],
        [
          stored('P1', '5', 'ADAPTER'),
          { ...stored('P3', '999', 'MANUAL'), deletedAt: new Date() },
        ],
      );
      await after(m, ['prm-P1']);
      expect(m.row('P3')).toMatchObject({
        observed1: '10',
        source: 'CALCULATED',
        deletedAt: null,
      });
    });

    it('a measured parameter that has a formula typed in counts as calculated; a blank formula on a measured parameter does not', async () => {
      const withFormula = { ...measured('W'), calculationFormula: 'P1 * 2' };
      const blank = { ...measured('B'), calculationFormula: '   ' };
      const m = makeTx(
        [measured('P1'), withFormula, blank],
        [stored('P1', '4', 'ADAPTER')],
      );
      await after(m, ['prm-P1']);
      expect(m.row('W')).toMatchObject({
        observed1: '8.00',
        source: 'CALCULATED',
      }); // no decimal places set: two
      expect(m.row('B')).toBeUndefined();
    });

    it('several calculated values, mixed: manual kept, sent-by-machine kept, the rest follow the formulas', async () => {
      const m = makeTx(
        [
          measured('P1'),
          calc('K1', 'P1 * 2'),
          calc('K2', 'P1 * 3'),
          calc('K3', 'P1 * 4'),
        ],
        [
          stored('P1', '5', 'ADAPTER'),
          stored('K1', '111', 'MANUAL'),
          stored('K2', '222', 'ADAPTER'),
          stored('K3', '0', 'CALCULATED'),
        ],
      );
      await after(m, ['prm-P1', 'prm-K2']);
      expect(m.row('K1')).toMatchObject({ observed1: '111', source: 'MANUAL' });
      expect(m.row('K2')).toMatchObject({
        observed1: '222',
        source: 'ADAPTER',
      });
      expect(m.row('K3')).toMatchObject({
        observed1: '20',
        source: 'CALCULATED',
      });
    });

    it('a machine-sent calculated value is kept only in the submission that sent it', async () => {
      const m = makeTx(
        [measured('P1'), calc('K', 'P1 * 2')],
        [stored('P1', '5', 'ADAPTER'), stored('K', '42', 'ADAPTER')],
      );
      await after(m, ['prm-P1', 'prm-K']);
      expect(m.row('K')).toMatchObject({ observed1: '42', source: 'ADAPTER' });
      await after(m, ['prm-P1']);
      expect(m.row('K')).toMatchObject({
        observed1: '10',
        source: 'CALCULATED',
      });
    });

    it("a database error while recalculating is not swallowed (the machine's whole submission then rolls back and can be retried)", async () => {
      const m = makeTx(
        [measured('P1'), calc('P3', 'P1 * 2')],
        [stored('P1', '5', 'ADAPTER')],
      );
      m.raw.labReportResultValue.findMany.mockRejectedValueOnce(
        new Error('connection lost'),
      );
      await expect(after(m, ['prm-P1'])).rejects.toThrow('connection lost');
    });
  });
});
