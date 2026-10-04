import { LabReportStatus } from '@prisma/client';
import { PERMISSION_KEYS } from '../../permissions/constants/module-permissions.constant';
import {
  STATUS_ACCESS_KEYS,
  isStatusVisible,
  visibleStatusesFor,
  worklistRowBranchWhere,
} from './worklist-branch-scope';

describe('STATUS_ACCESS_KEYS', () => {
  it('maps every report status to its own, distinct access key', () => {
    const statuses = Object.values(LabReportStatus);
    const keys = statuses.map((s) => STATUS_ACCESS_KEYS[s]);
    expect(keys.every((k) => typeof k === 'string' && k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(statuses.length);
  });
});

describe('visibleStatusesFor', () => {
  it('grants exactly the statuses whose access key is held', () => {
    const got = visibleStatusesFor(
      new Set([
        PERMISSION_KEYS.LAB_ACCESS_PENDING,
        PERMISSION_KEYS.LAB_ACCESS_APPROVED,
      ]),
    );
    expect([...got].sort()).toEqual(
      [LabReportStatus.PENDING, LabReportStatus.APPROVED].sort(),
    );
  });

  it('action keys alone grant no visibility (a different layer than "can see")', () => {
    const got = visibleStatusesFor(
      new Set([
        PERMISSION_KEYS.LAB_ENTER_RESULT,
        PERMISSION_KEYS.LAB_EDIT_REPORT,
      ]),
    );
    expect(got.size).toBe(0);
  });

  it('an empty permission set sees nothing', () => {
    expect(visibleStatusesFor(new Set()).size).toBe(0);
  });
});

describe('isStatusVisible', () => {
  it("'ALL' shows every status", () => {
    for (const s of Object.values(LabReportStatus)) {
      expect(isStatusVisible('ALL', s)).toBe(true);
    }
  });

  it('an explicit set shows only its members', () => {
    const set = new Set([LabReportStatus.SAVED]);
    expect(isStatusVisible(set, LabReportStatus.SAVED)).toBe(true);
    expect(isStatusVisible(set, LabReportStatus.APPROVED)).toBe(false);
  });

  it('an empty set shows nothing', () => {
    expect(isStatusVisible(new Set(), LabReportStatus.PENDING)).toBe(false);
  });
});

describe('worklistRowBranchWhere (special worklists)', () => {
  it('a full-visibility branch is matched on branch alone', () => {
    expect(
      worklistRowBranchWhere({ rules: [{ branchId: 'A', statuses: 'ALL' }] }),
    ).toEqual({ OR: [{ branchId: 'A' }] });
  });

  it("each branch keeps ITS OWN statuses — one branch's statuses never leak to another", () => {
    const w = worklistRowBranchWhere({
      rules: [
        { branchId: 'A', statuses: 'ALL' },
        { branchId: 'B', statuses: new Set([LabReportStatus.PENDING]) },
        { branchId: 'C', statuses: new Set([LabReportStatus.APPROVED]) },
      ],
    });
    expect(w.OR).toEqual([
      { branchId: 'A' },
      {
        branchId: 'B',
        labReport: { status: { in: [LabReportStatus.PENDING] } },
      },
      {
        branchId: 'C',
        labReport: { status: { in: [LabReportStatus.APPROVED] } },
      },
    ]);
  });

  it('a branch granting no statuses contributes nothing', () => {
    const w = worklistRowBranchWhere({
      rules: [
        { branchId: 'A', statuses: 'ALL' },
        { branchId: 'D', statuses: new Set() },
      ],
    });
    expect(w.OR).toEqual([{ branchId: 'A' }]);
  });

  it('no usable branch yields an empty OR (matches nothing — never everything)', () => {
    expect(
      worklistRowBranchWhere({
        rules: [{ branchId: 'D', statuses: new Set() }],
      }).OR,
    ).toEqual([]);
    expect(worklistRowBranchWhere({ rules: [] }).OR).toEqual([]);
  });
});
