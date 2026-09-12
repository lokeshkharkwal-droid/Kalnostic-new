import { LabReportStatus, OrderStatus } from '@prisma/client';
import { deriveReportStatus, resolveBillGenerated } from './order.entity';

/**
 * Unit coverage for `resolveBillGenerated` — the pure "Generate Bill"
 * derivation shared by `OrderService.create`/`update`. Guards the fix for a
 * bug where a Quotation's payment ledger was silently zeroed on its first
 * edit because `isBillGenerated` (a concept the Quote form never sends) fell
 * back to a stale/omitted stored value.
 */
describe('resolveBillGenerated', () => {
  it('is always true for a QUOTE, regardless of dto/existing values', () => {
    expect(resolveBillGenerated(OrderStatus.QUOTE, undefined)).toBe(true);
    expect(resolveBillGenerated(OrderStatus.QUOTE, false)).toBe(true);
    expect(resolveBillGenerated(OrderStatus.QUOTE, false, false)).toBe(true);
    expect(resolveBillGenerated(OrderStatus.QUOTE, undefined, false)).toBe(
      true,
    );
  });

  it('honours an explicit false for ORDER/APPOINTMENT/DRAFT (existing "Generate Bill = No" behaviour unchanged)', () => {
    expect(resolveBillGenerated(OrderStatus.ORDER, false)).toBe(false);
    expect(resolveBillGenerated(OrderStatus.APPOINTMENT, false)).toBe(false);
    expect(resolveBillGenerated(OrderStatus.DRAFT, false)).toBe(false);
  });

  it('falls back to the existing stored value when the dto omits it', () => {
    expect(resolveBillGenerated(OrderStatus.ORDER, undefined, false)).toBe(
      false,
    );
    expect(resolveBillGenerated(OrderStatus.ORDER, undefined, true)).toBe(true);
  });

  it('defaults to true when both the dto and the existing value are absent', () => {
    expect(resolveBillGenerated(OrderStatus.ORDER, undefined)).toBe(true);
  });

  it('an explicit dto value overrides a stored existing value', () => {
    expect(resolveBillGenerated(OrderStatus.ORDER, true, false)).toBe(true);
    expect(resolveBillGenerated(OrderStatus.ORDER, false, true)).toBe(false);
  });
});

/**
 * Unit coverage for `deriveReportStatus` — the Order Console's "Order
 * Status" rollup. Guards the fix for a bug where an order with multiple
 * lab panels/items read as APPROVED once just one item finished: a panel
 * item's `LabReport`s are created lazily, one per member test, so
 * `labReports.length` alone understates a panel's true size while
 * accession is still in progress. `panelMemberCounts` supplies each
 * panel's real, current member-test count instead.
 */
describe('deriveReportStatus', () => {
  const report = (
    status: LabReportStatus,
    memberBranchLabTestId: string | null = null,
  ) => ({ status, memberBranchLabTestId });

  it('returns PENDING for an order with no items', () => {
    expect(deriveReportStatus([], new Map())).toBe('PENDING');
  });

  it('reads APPROVED for a single non-panel item that is approved (no regression)', () => {
    const items = [
      {
        branchLabPanel: null,
        labReports: [report(LabReportStatus.APPROVED)],
      },
    ];
    expect(deriveReportStatus(items, new Map())).toBe('APPROVED');
  });

  it('reads PARTIALLY_COMPLETED — not APPROVED — when one item is done and another (an untouched multi-member panel) has not started', () => {
    const items = [
      {
        branchLabPanel: null,
        labReports: [report(LabReportStatus.APPROVED)],
      },
      {
        // Panel with 4 true member tests, none accepted yet — zero reports.
        branchLabPanel: { id: 'panel-1' },
        labReports: [],
      },
    ];
    const panelMemberCounts = new Map([['panel-1', 4]]);
    expect(deriveReportStatus(items, panelMemberCounts)).toBe(
      'PARTIALLY_COMPLETED',
    );
  });

  it("reads PARTIALLY_COMPLETED — not APPROVED — when only 1 of a panel item's N member reports is created and approved", () => {
    const items = [
      {
        // Panel with 4 true member tests; only 1 accepted so far, and approved.
        branchLabPanel: { id: 'panel-1' },
        labReports: [report(LabReportStatus.APPROVED, 'member-1')],
      },
    ];
    const panelMemberCounts = new Map([['panel-1', 4]]);
    expect(deriveReportStatus(items, panelMemberCounts)).toBe(
      'PARTIALLY_COMPLETED',
    );
  });

  it("reads APPROVED once every one of a panel item's N member reports is approved", () => {
    const items = [
      {
        branchLabPanel: { id: 'panel-1' },
        labReports: [
          report(LabReportStatus.APPROVED, 'member-1'),
          report(LabReportStatus.APPROVED, 'member-2'),
          report(LabReportStatus.PUBLISHED, 'member-3'),
        ],
      },
    ];
    const panelMemberCounts = new Map([['panel-1', 3]]);
    expect(deriveReportStatus(items, panelMemberCounts)).toBe('APPROVED');
  });

  it('reads APPROVED for a grandfathered single-combined-report panel item (no regression for legacy panels)', () => {
    const items = [
      {
        branchLabPanel: { id: 'panel-1' },
        // Grandfathered report: memberBranchLabTestId is null even though
        // the item is a panel — predates the per-member-test breakdown.
        labReports: [report(LabReportStatus.APPROVED, null)],
      },
    ];
    // The panel's CURRENT catalogue has 4 member tests, but this legacy
    // item's one combined report is still its whole story.
    const panelMemberCounts = new Map([['panel-1', 4]]);
    expect(deriveReportStatus(items, panelMemberCounts)).toBe('APPROVED');
  });
});
