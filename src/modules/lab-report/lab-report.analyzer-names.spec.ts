import { ResultValueSource } from '@prisma/client';
import { LabReportService } from './lab-report.service';

/**
 * `GET /lab-reports/:id` adds `analyzerName` to every value an analyzer filled, so the screen can
 * say WHICH analyzer when it asks "Overwrite the analyzer's result?".
 */
type Row = {
  resultParamId: string;
  source: ResultValueSource;
  enteredBy: string | null;
};
const row = (
  resultParamId: string,
  source: ResultValueSource,
  enteredBy: string | null,
): Row => ({ resultParamId, source, enteredBy });

function build(adapters: Array<{ id: string; name: string }>) {
  const labAdapter = { findMany: jest.fn().mockResolvedValue(adapters) };
  const deps = Array(11).fill(undefined) as unknown[];
  deps[0] = { labAdapter };
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );
  const attach = (rows: Row[]) =>
    (
      service as unknown as {
        attachAnalyzerNames: (
          tenantId: string,
          values: Row[],
        ) => Promise<Array<Row & { analyzerName: string | null }>>;
      }
    ).attachAnalyzerNames('t1', rows);
  return { labAdapter, attach };
}

describe('attachAnalyzerNames', () => {
  it("names an analyzer's value after its analyzer, with one lookup for all of them", async () => {
    const m = build([
      { id: 'a1', name: 'Cobas' },
      { id: 'a2', name: 'Sysmex' },
    ]);
    const out = await m.attach([
      row('p1', ResultValueSource.ADAPTER, 'a1'),
      row('p2', ResultValueSource.ADAPTER, 'a2'),
      row('p3', ResultValueSource.ADAPTER, 'a1'),
    ]);
    expect(out.map((v) => v.analyzerName)).toEqual([
      'Cobas',
      'Sysmex',
      'Cobas',
    ]);
    expect(m.labAdapter.findMany).toHaveBeenCalledTimes(1);
    expect(m.labAdapter.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2'] }, tenantId: 't1' },
      select: { id: true, name: true },
    });
  });

  it("a technician's or calculated value has no analyzer name, and no lookup is made when there is no analyzer value", async () => {
    const m = build([]);
    const out = await m.attach([
      row('p1', ResultValueSource.MANUAL, 'person-1'),
      row('p2', ResultValueSource.CALCULATED, 'person-1'),
    ]);
    expect(out.map((v) => v.analyzerName)).toEqual([null, null]);
    expect(m.labAdapter.findMany).not.toHaveBeenCalled();
  });

  it('an analyzer that cannot be found (or a value with no analyzer id) gets null', async () => {
    const m = build([{ id: 'a1', name: 'Cobas' }]);
    const out = await m.attach([
      row('p1', ResultValueSource.ADAPTER, 'gone'),
      row('p2', ResultValueSource.ADAPTER, null),
      row('p3', ResultValueSource.ADAPTER, 'a1'),
    ]);
    expect(out.map((v) => v.analyzerName)).toEqual([null, null, 'Cobas']);
  });

  it('keeps every other field of the value as it was', async () => {
    const m = build([{ id: 'a1', name: 'Cobas' }]);
    const [v] = await m.attach([row('p1', ResultValueSource.ADAPTER, 'a1')]);
    expect(v).toMatchObject({
      resultParamId: 'p1',
      source: ResultValueSource.ADAPTER,
      enteredBy: 'a1',
    });
  });
});
