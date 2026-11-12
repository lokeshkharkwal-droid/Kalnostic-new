import {
  PLAIN_LAB_REPORT_NOTE_CATEGORIES,
  emptyNoteCounts,
  formatSampleLabel,
  labReportNotesForOrdersWhere,
  resolveReportLabels,
} from './lab-report-note.util';

describe('labReportNotesForOrdersWhere', () => {
  it('reads only live Order / Sample / Tech notes on live reports of the orders', () => {
    expect(labReportNotesForOrdersWhere('t1', ['o1', 'o2'])).toEqual({
      tenantId: 't1',
      deletedAt: null,
      category: { in: ['ORDER', 'SAMPLE', 'TECH'] },
      labReport: {
        tenantId: 't1',
        deletedAt: null,
        orderItem: { orderId: { in: ['o1', 'o2'] } },
      },
    });
  });

  it('narrows to one category when given', () => {
    expect(labReportNotesForOrdersWhere('t1', ['o1'], 'TECH').category).toBe(
      'TECH',
    );
  });

  it('never counts workflow reasons (LOCK, DELTA, RE_RUN, …) as notes', () => {
    expect([...PLAIN_LAB_REPORT_NOTE_CATEGORIES]).toEqual([
      'ORDER',
      'SAMPLE',
      'TECH',
    ]);
    expect(emptyNoteCounts()).toEqual({ ORDER: 0, SAMPLE: 0, TECH: 0 });
  });
});

describe('formatSampleLabel', () => {
  it('joins name and barcode, or keeps whichever exists', () => {
    expect(formatSampleLabel('Blood (EDTA)', '10010')).toBe(
      'Blood (EDTA) · 10010',
    );
    expect(formatSampleLabel('Urine', null)).toBe('Urine');
    expect(formatSampleLabel(null, '10010')).toBe('10010');
    expect(formatSampleLabel('  ', undefined)).toBeNull();
  });
});

describe('resolveReportLabels', () => {
  type WhereArgs = { where: Record<string, unknown> };
  const labReportFindMany = jest.fn<Promise<unknown[]>, [WhereArgs]>();
  const branchLabTestFindMany = jest.fn<Promise<unknown[]>, [WhereArgs]>();
  const orderSampleTestFindMany = jest.fn<Promise<unknown[]>, [WhereArgs]>();
  const db = {
    labReport: { findMany: labReportFindMany },
    branchLabTest: { findMany: branchLabTestFindMany },
    orderSampleTest: { findMany: orderSampleTestFindMany },
  } as unknown as Parameters<typeof resolveReportLabels>[0];

  beforeEach(() => {
    labReportFindMany.mockReset();
    branchLabTestFindMany.mockReset();
    orderSampleTestFindMany.mockReset();
  });

  it('makes no query for an empty set', async () => {
    expect((await resolveReportLabels(db, 't1', [])).size).toBe(0);
    expect(labReportFindMany).not.toHaveBeenCalled();
  });

  it('labels each report with its test and its own sample(s)', async () => {
    labReportFindMany.mockResolvedValue([
      // standalone test: every sample of its order item
      {
        id: 'r-cbc',
        labTestId: 'lt-cbc',
        memberBranchLabTestId: null,
        orderItemId: 'oi-1',
        orderItem: {
          branchLabTest: { testName: 'CBC' },
          branchLabPanel: null,
        },
      },
      // panel member: only the samples of ITS member test, named after it
      {
        id: 'r-urea',
        labTestId: 'lt-urea',
        memberBranchLabTestId: 'blt-urea',
        orderItemId: 'oi-2',
        orderItem: {
          branchLabTest: null,
          branchLabPanel: { panelName: 'KFT' },
        },
      },
      // grandfathered panel report: the panel's name, no sample
      {
        id: 'r-panel',
        labTestId: null,
        memberBranchLabTestId: null,
        orderItemId: 'oi-3',
        orderItem: {
          branchLabTest: null,
          branchLabPanel: { panelName: 'LFT' },
        },
      },
    ]);
    branchLabTestFindMany.mockResolvedValue([
      { id: 'blt-urea', testName: 'Urea' },
    ]);
    orderSampleTestFindMany.mockResolvedValue([
      {
        orderItemId: 'oi-1',
        labTestId: 'lt-cbc',
        sample: { sampleName: 'Blood (EDTA)', barcode: '10010' },
      },
      // the receiver's copy after an internal transfer: same label, shown once
      {
        orderItemId: 'oi-1',
        labTestId: 'lt-cbc',
        sample: { sampleName: 'Blood (EDTA)', barcode: '10010' },
      },
      {
        orderItemId: 'oi-2',
        labTestId: 'lt-urea',
        sample: { sampleName: 'Serum', barcode: '10011' },
      },
      {
        orderItemId: 'oi-2',
        labTestId: 'lt-creat',
        sample: { sampleName: 'Urine', barcode: '10012' },
      },
    ]);

    const labels = await resolveReportLabels(db, 't1', [
      'r-cbc',
      'r-urea',
      'r-panel',
      'r-cbc',
    ]);

    expect(labels.get('r-cbc')).toEqual({
      testName: 'CBC',
      sampleLabel: 'Blood (EDTA) · 10010',
    });
    expect(labels.get('r-urea')).toEqual({
      testName: 'Urea',
      sampleLabel: 'Serum · 10011',
    });
    expect(labels.get('r-panel')).toEqual({
      testName: 'LFT',
      sampleLabel: null,
    });
    // batched: one query per table, ids de-duplicated
    expect(labReportFindMany).toHaveBeenCalledTimes(1);
    expect(labReportFindMany.mock.calls[0]![0].where).toEqual({
      id: { in: ['r-cbc', 'r-urea', 'r-panel'] },
      tenantId: 't1',
    });
    expect(orderSampleTestFindMany.mock.calls[0]![0].where).toEqual({
      tenantId: 't1',
      deletedAt: null,
      orderItemId: { in: ['oi-1', 'oi-2', 'oi-3'] },
    });
  });
});
