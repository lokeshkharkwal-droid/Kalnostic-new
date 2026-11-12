import {
  ContainerType,
  OrderType,
  SamplePriority,
  SampleStatus,
  TransferKind,
} from '@prisma/client';
import { timestampRange } from '../../../common/utils/date-range.util';
import { TRANSFERRED_STATUSES } from '../constants/sample-transitions.constant';
import { TERMINAL_SAMPLE_STATUSES } from '../constants/tat.constant';
import {
  applyOrderMode,
  buildSampleFilterConditions,
  transferMatches,
  transferWhereOf,
} from './sample-filters.util';

const TAT = {
  warningMinutes: 40,
  criticalMinutes: 70,
  breachedMinutes: 100,
};

describe('buildSampleFilterConditions — filters only, never scope', () => {
  it('returns nothing for an empty query', () => {
    expect(buildSampleFilterConditions({}, TAT, Date.now())).toEqual({
      sample: {},
      order: {},
      and: [],
    });
  });

  it('never carries tenant / branch / deleted / department scope (the caller adds those)', () => {
    const { sample, order, and } = buildSampleFilterConditions(
      {
        status: SampleStatus.ACCEPTED,
        search: 'abc',
        destinationBranchId: 'b1',
        sendDate: '2026-10-28',
        dateFrom: '2026-10-01',
        isUrgent: true,
      },
      TAT,
      Date.now(),
    );
    const text = JSON.stringify({ sample, order, and });
    expect(text).not.toContain('tenantId');
    expect(text).not.toContain('"branchId"');
    expect(text).not.toContain('deletedAt":null,"departmentId');
    expect(sample).not.toHaveProperty('tenantId');
    expect(sample).not.toHaveProperty('branchId');
    expect(sample).not.toHaveProperty('deletedAt');
    expect(JSON.stringify(and)).not.toContain('departmentId');
  });

  it('maps the direct sample columns', () => {
    const { sample } = buildSampleFilterConditions(
      {
        status: SampleStatus.STORED,
        priority: SamplePriority.URGENT,
        orderId: 'o1',
        originBranchId: 'b9',
        processingBranchId: 'b8',
      },
      TAT,
      Date.now(),
    );
    expect(sample).toEqual({
      status: SampleStatus.STORED,
      priority: SamplePriority.URGENT,
      orderId: 'o1',
      originBranchId: 'b9',
      processingBranchId: 'b8',
    });
  });

  it("does not read the sample's own (never written) report status column", () => {
    const { sample, and } = buildSampleFilterConditions(
      { reportStatus: 'SAVED' },
      TAT,
      Date.now(),
    );
    expect(sample).toEqual({});
    expect(and).toEqual([]);
  });

  it('adds the resolved report-status samples and category tests as id lists', () => {
    const { and } = buildSampleFilterConditions({}, TAT, Date.now(), {
      reportStatusSampleIds: ['s1', 's2'],
      labTestIds: ['t1'],
    });
    expect(and).toContainEqual({ id: { in: ['s1', 's2'] } });
    expect(and).toContainEqual({ labTestId: { in: ['t1'] } });
  });

  it('an empty resolved list matches nothing (a category with no tests)', () => {
    const { and } = buildSampleFilterConditions({}, TAT, Date.now(), {
      labTestIds: [],
    });
    expect(and).toContainEqual({ labTestId: { in: [] } });
  });

  it('a TAT band without a status tab excludes the terminal statuses; with a tab it keeps the tab', () => {
    const open = buildSampleFilterConditions(
      { tatStatus: 'BREACHED' },
      TAT,
      Date.parse('2026-10-30T10:00:00Z'),
    ).sample;
    expect(open.createdAt).toEqual({
      lte: new Date(Date.parse('2026-10-30T10:00:00Z') - 100 * 60000),
    });
    expect(open.status).toEqual({ notIn: [...TERMINAL_SAMPLE_STATUSES] });

    const tab = buildSampleFilterConditions(
      { tatStatus: 'BREACHED', status: SampleStatus.ACCEPTED },
      TAT,
      Date.parse('2026-10-30T10:00:00Z'),
    ).sample;
    expect(tab.status).toBe(SampleStatus.ACCEPTED);
  });

  it('puts order-level filters on the order relation', () => {
    const { order } = buildSampleFilterConditions(
      {
        patientId: 'p1',
        referredByDoctorId: 'd1',
        referralPanelId: 'r1',
        isHomeCollection: true,
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
      },
      TAT,
      Date.now(),
    );
    expect(order.patientId).toBe('p1');
    expect(order.referredByDoctorId).toBe('d1');
    expect(order.referralPanelId).toBe('r1');
    expect(order.diagnostics).toEqual({ is: { isHomeVisit: true } });
    expect(order.orderDate).toEqual({
      gte: new Date('2026-10-01'),
      lte: new Date('2026-10-31'),
    });
  });

  it('keeps the department filter on the order items (order level)', () => {
    const { order } = buildSampleFilterConditions(
      { departmentId: 'dep1', branchLabTestId: 't1' },
      TAT,
      Date.now(),
    );
    expect(order.items).toEqual({
      some: {
        deletedAt: null,
        branchLabTestId: 't1',
        branchLabTest: { is: { departmentId: 'dep1' } },
      },
    });
  });

  it('search covers barcode, order code and the patient fields - NOT the accession number', () => {
    const { and } = buildSampleFilterConditions(
      { search: 'ord-7' },
      TAT,
      Date.now(),
    );
    const or = (and[0] as { OR: unknown[] }).OR;
    expect(or).toContainEqual({
      barcode: { contains: 'ord-7', mode: 'insensitive' },
    });
    expect(or).toContainEqual({
      order: { is: { orderCode: { contains: 'ord-7', mode: 'insensitive' } } },
    });
    expect(JSON.stringify(or)).not.toContain('accessionNo');
    // barcode, order code and the patient block (name x3, UHID, mobile)
    expect(or).toHaveLength(3);
  });

  it('destination + send date must be met by ONE transfer (a single transfers.some)', () => {
    const { and } = buildSampleFilterConditions(
      { destinationBranchId: 'bB', sendDate: '2026-10-28' },
      TAT,
      Date.now(),
    );
    const range = timestampRange('2026-10-28', '2026-10-28');
    const transferConds = and.filter((c) => 'transfers' in c);
    expect(transferConds).toHaveLength(1);
    expect(transferConds[0]).toEqual({
      status: SampleStatus.SENT_INTERNAL,
      transfers: {
        some: {
          deletedAt: null,
          kind: TransferKind.INTERNAL,
          AND: [
            { destinationBranchId: 'bB' },
            { OR: [{ sendDate: range }, { sendDate: null, createdAt: range }] },
          ],
        },
      },
    });
  });
});

describe('buildSampleFilterConditions — the new Accession filters', () => {
  it('order type and "billed by" go on the order', () => {
    const { order } = buildSampleFilterConditions(
      { orderType: OrderType.APP, createdByUserId: 'u1' },
      TAT,
      Date.now(),
    );
    expect(order.orderType).toBe(OrderType.APP);
    expect(order.createdBy).toBe('u1');
  });

  it('container types and a storage-location search go on the sample (literal text, any case)', () => {
    const { sample } = buildSampleFilterConditions(
      {
        containerTypes: [ContainerType.URINE_CONTAINER, ContainerType.SWAB],
        storeLocation: '  Freezer_1% ',
      },
      TAT,
      Date.now(),
    );
    expect(sample.containerType).toEqual({
      in: [ContainerType.URINE_CONTAINER, ContainerType.SWAB],
    });
    expect(sample.storeLocation).toEqual({
      contains: 'Freezer\\_1\\%',
      mode: 'insensitive',
    });
  });

  it('logistics person matches the sample column or the transfer of a sample that is out', () => {
    const { and } = buildSampleFilterConditions(
      { logisticsPerson: 'ravi' },
      TAT,
      Date.now(),
    );
    const contains = { contains: 'ravi', mode: 'insensitive' };
    expect(and).toContainEqual({
      OR: [
        { logisticsPerson: contains },
        {
          status: { in: [...TRANSFERRED_STATUSES] },
          transfers: { some: { deletedAt: null, logisticsPerson: contains } },
        },
      ],
    });
  });

  it("discard method matches the reason of the sample's discard history entry", () => {
    const { and } = buildSampleFilterConditions(
      { discardMethod: 'Autoclave' },
      TAT,
      Date.now(),
    );
    expect(and).toContainEqual({
      statusHistory: {
        some: {
          action: 'discard',
          deletedAt: null,
          reason: { equals: 'Autoclave', mode: 'insensitive' },
        },
      },
    });
  });

  it('sample names match the exact spellings sent (commas kept); "not set" also matches blanks', () => {
    const exact = buildSampleFilterConditions(
      { sampleNames: ['Serum-Plain', 'Serum (Plain)', 'BUN, Body Fluid'] },
      TAT,
      Date.now(),
    ).and;
    expect(exact).toContainEqual({
      sampleName: { in: ['Serum-Plain', 'Serum (Plain)', 'BUN, Body Fluid'] },
    });

    const both = buildSampleFilterConditions(
      { sampleNames: ['CSF'], sampleNameNotSet: true },
      TAT,
      Date.now(),
    ).and;
    expect(both).toContainEqual({
      OR: [
        { sampleName: { in: ['CSF'] } },
        { OR: [{ sampleName: null }, { sampleName: '' }] },
      ],
    });

    const onlyBlank = buildSampleFilterConditions(
      { sampleNameNotSet: true },
      TAT,
      Date.now(),
    ).and;
    expect(onlyBlank).toContainEqual({
      OR: [{ sampleName: null }, { sampleName: '' }],
    });
  });

  it('sample types work the same way on the type column', () => {
    const { and } = buildSampleFilterConditions(
      { sampleTypes: ['Whole Blood', 'Blood'], sampleTypeNotSet: true },
      TAT,
      Date.now(),
    );
    expect(and).toContainEqual({
      OR: [
        { sampleType: { in: ['Whole Blood', 'Blood'] } },
        { OR: [{ sampleType: null }, { sampleType: '' }] },
      ],
    });
  });

  it('no name / type filter adds nothing', () => {
    const { and } = buildSampleFilterConditions(
      { sampleNames: [], sampleTypes: [] },
      TAT,
      Date.now(),
    );
    expect(and).toEqual([]);
  });
});

describe('transferMatches / transferWhereOf', () => {
  it('lists nothing without a transfer filter', () => {
    expect(transferMatches({})).toEqual([]);
  });

  it('a lone center keeps the plain shape and does not require a sample status', () => {
    const [m] = transferMatches({ outsourceCenterId: 'c1' });
    expect(m).toMatchObject({
      kind: TransferKind.OUTSOURCE,
      sampleStatus: undefined,
    });
    expect(transferWhereOf(m!)).toEqual({
      deletedAt: null,
      kind: TransferKind.OUTSOURCE,
      outsourceCenterId: 'c1',
    });
  });

  it('a destination / partner means "still Sent / Forwarded now", a date alone does not', () => {
    expect(transferMatches({ destinationBranchId: 'b' })[0]!.sampleStatus).toBe(
      SampleStatus.SENT_INTERNAL,
    );
    expect(
      transferMatches({ externalPartnerName: 'Apollo' })[0]!.sampleStatus,
    ).toBe(SampleStatus.FORWARD_EXTERNAL);
    expect(
      transferMatches({ sendDate: '2026-10-28' })[0]!.sampleStatus,
    ).toBeUndefined();
  });

  it('keeps one entry per kind and never mixes kinds', () => {
    const matches = transferMatches({
      destinationBranchId: 'b',
      forwardDate: '2026-10-28',
      outsourceCenterId: 'c',
      outsourceDate: '2026-10-29',
    });
    expect(matches.map((m) => m.kind)).toEqual([
      TransferKind.INTERNAL,
      TransferKind.EXTERNAL,
      TransferKind.OUTSOURCE,
    ]);
    expect(matches[2]!.conditions).toHaveLength(2);
  });

  it('partner text is literal (% and _ escaped) and trimmed', () => {
    const [m] = transferMatches({ externalPartnerName: ' a_b% ' });
    expect(m!.conditions[0]).toEqual({
      externalPartnerName: {
        contains: String.raw`a\_b\%`,
        mode: 'insensitive',
      },
    });
  });

  it('knows the transferred statuses', () => {
    expect(TRANSFERRED_STATUSES.has(SampleStatus.OUTSOURCED)).toBe(true);
    expect(TRANSFERRED_STATUSES.has(SampleStatus.ACCEPTED)).toBe(false);
  });
});

describe('applyOrderMode (pinned old behaviour; replaced by Order Type later)', () => {
  it.each([
    ['Home Visit', { diagnostics: { is: { isHomeVisit: true } } }],
    ['Walk-in', { diagnostics: { is: { isHomeVisit: false } } }],
    ['Emergency', { isUrgentBill: true }],
  ] as const)('%s maps to an order condition', (mode, expected) => {
    const order = {};
    const and: never[] = [];
    applyOrderMode(mode, order, and);
    expect(order).toEqual(expected);
    expect(and).toEqual([]);
  });

  it('Outsource maps to the OUTSOURCED status; Referral to either referral present', () => {
    const order: Record<string, unknown> = {};
    const and: unknown[] = [];
    applyOrderMode('Outsource', order, and as never);
    expect(and).toEqual([{ status: SampleStatus.OUTSOURCED }]);
    applyOrderMode('Referral', order, and as never);
    expect(order.OR).toEqual([
      { internalReferralId: { not: null } },
      { externalReferralId: { not: null } },
    ]);
  });
});
