import { LabReportStatus } from '@prisma/client';
import { toWorklistRow } from './entities/lab-report.entity';
import type { LabReportListRow } from './entities/lab-report.entity';

/**
 * Regression coverage for task §1: the department DISPLAYED for a report on the
 * Technician Reporting worklist must be the report's OWN department (the panel
 * MEMBER test's for a panel-member report, the standalone test's otherwise), never
 * the parent panel's. `toWorklistRow` reads the denormalized `LabReport.departmentId`
 * for the non-transferred case; a transferred report keeps using the chosen
 * performing entry's department (a genuinely different value).
 */
function makeRow(over: Partial<LabReportListRow>): LabReportListRow {
  return {
    id: 'r1',
    status: LabReportStatus.PENDING,
    isUrgent: false,
    isOutsourced: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    isLocked: false,
    lockNotes: null,
    lockedAt: null,
    lockedBy: null,
    branchId: 'b1',
    departmentId: null,
    labTestId: null,
    memberBranchLabTestId: null,
    orderItemId: 'oi1',
    performingEntry: null,
    orderItem: null,
    ...over,
  } as unknown as LabReportListRow;
}

describe('toWorklistRow — department display', () => {
  it('a PANEL-MEMBER report shows its MEMBER department, not the parent panel department', () => {
    const row = makeRow({
      departmentId: 'MEMBER_DEPT', // stamped from the member test at creation
      memberBranchLabTestId: 'm1',
      orderItem: {
        order: null,
        // The parent panel sits in a DIFFERENT department — must be ignored here.
        branchLabPanel: {
          id: 'p1',
          panelName: 'Thyroid',
          departmentId: 'PANEL_DEPT',
        },
        branchLabTest: null,
      },
    } as unknown as Partial<LabReportListRow>);
    expect(toWorklistRow(row).departmentId).toBe('MEMBER_DEPT');
  });

  it('a STANDALONE test report shows its own denormalized department', () => {
    const row = makeRow({
      departmentId: 'HEMATOLOGY',
      orderItem: {
        order: null,
        branchLabTest: {
          id: 't1',
          testName: 'CBC',
          departmentId: 'HEMATOLOGY',
        },
        branchLabPanel: null,
      },
    } as unknown as Partial<LabReportListRow>);
    expect(toWorklistRow(row).departmentId).toBe('HEMATOLOGY');
  });

  it('an unassigned report (null department) shows null', () => {
    const row = makeRow({ departmentId: null });
    expect(toWorklistRow(row).departmentId).toBeNull();
  });

  it('a TRANSFERRED report uses the performing entry department (even if null), not the report line', () => {
    const row = makeRow({
      departmentId: 'MEMBER_DEPT',
      performingEntry: { departmentId: 'RECEIVER_DEPT' } as never,
    });
    expect(toWorklistRow(row).departmentId).toBe('RECEIVER_DEPT');

    const rowNullEntry = makeRow({
      departmentId: 'MEMBER_DEPT',
      performingEntry: { departmentId: null } as never,
    });
    // The holding branch's chosen entry has no department → unassigned, NOT a
    // fallback to the order line's department.
    expect(toWorklistRow(rowNullEntry).departmentId).toBeNull();
  });
});
