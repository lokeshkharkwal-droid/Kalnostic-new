import { LabReportStatus } from '@prisma/client';
import {
  diffOrderItems,
  isTestDeletable,
  isDisallowedOverpayment,
  type IncomingOrderItem,
} from './order-item-diff';

describe('diffOrderItems', () => {
  it('classifies keep / add / remove by stable id', () => {
    const existing = ['a', 'b', 'c'];
    const incoming: IncomingOrderItem[] = [
      { id: 'a', branchLabTestId: 't1' }, // keep
      { id: 'b', branchLabTestId: 't2' }, // keep
      { branchLabTestId: 't9' },          // add (no id)
    ]; // 'c' absent -> remove
    const diff = diffOrderItems(existing, incoming);
    expect(diff.keep.map((k) => k.id).sort()).toEqual(['a', 'b']);
    expect(diff.add).toHaveLength(1);
    expect(diff.add[0]!.branchLabTestId).toBe('t9');
    expect(diff.removeIds).toEqual(['c']);
  });

  it('ignores an incoming id that is not an existing live item (treats as add)', () => {
    const diff = diffOrderItems(['a'], [{ id: 'ghost', branchLabTestId: 't1' }]);
    expect(diff.keep).toHaveLength(0);
    expect(diff.add).toHaveLength(1);
    expect(diff.removeIds).toEqual(['a']);
  });
});

describe('isTestDeletable', () => {
  it('allows removal when no report or only pending reports', () => {
    expect(isTestDeletable([])).toBe(true);
    expect(isTestDeletable([LabReportStatus.PENDING, LabReportStatus.PARTIAL_PENDING])).toBe(true);
  });
  it('blocks removal once any report is SAVED or beyond', () => {
    expect(isTestDeletable([LabReportStatus.PENDING, LabReportStatus.SAVED])).toBe(false);
    expect(isTestDeletable([LabReportStatus.APPROVED])).toBe(false);
    expect(isTestDeletable([LabReportStatus.RESULT_REJECTED])).toBe(false);
  });
});

describe('isDisallowedOverpayment', () => {
  it('permits a removal-driven surplus (paid unchanged, net dropped)', () => {
    // paid 1000, new net 700, previously paid 1000 -> surplus is refundable, allowed
    expect(isDisallowedOverpayment(1000, 700, 1000)).toBe(false);
  });
  it('rejects collecting MORE than owed (paid increased beyond net)', () => {
    expect(isDisallowedOverpayment(1200, 700, 1000)).toBe(true);
  });
  it('permits a normal fully-covered payment', () => {
    expect(isDisallowedOverpayment(700, 700, 0)).toBe(false);
  });
});
