import { LabReportStatus } from '@prisma/client';
import {
  diffOrderItems,
  diffOrderPayments,
  isTestDeletable,
  isDisallowedOverpayment,
  type IncomingOrderItem,
  type IncomingOrderPayment,
} from './order-item-diff';

describe('diffOrderItems', () => {
  it('classifies keep / add / remove by stable id', () => {
    const existing = ['a', 'b', 'c'];
    const incoming: IncomingOrderItem[] = [
      { id: 'a', branchLabTestId: 't1' }, // keep
      { id: 'b', branchLabTestId: 't2' }, // keep
      { branchLabTestId: 't9' }, // add (no id)
    ]; // 'c' absent -> remove
    const diff = diffOrderItems(existing, incoming);
    expect(diff.keep.map((k) => k.id).sort()).toEqual(['a', 'b']);
    expect(diff.add).toHaveLength(1);
    expect(diff.add[0]!.branchLabTestId).toBe('t9');
    expect(diff.removeIds).toEqual(['c']);
  });

  it('ignores an incoming id that is not an existing live item (treats as add)', () => {
    const diff = diffOrderItems(
      ['a'],
      [{ id: 'ghost', branchLabTestId: 't1' }],
    );
    expect(diff.keep).toHaveLength(0);
    expect(diff.add).toHaveLength(1);
    expect(diff.removeIds).toEqual(['a']);
  });
});

describe('diffOrderPayments', () => {
  it('keeps rows whose id matches a live PAYMENT row and appends the rest', () => {
    const incoming: IncomingOrderPayment[] = [
      { id: 'p1', paidAmount: 500 }, // keep (canonical)
      { id: 'p2', paidAmount: 200 }, // keep
      { paidAmount: 300 }, // add (new split, no id)
    ];
    const diff = diffOrderPayments(['p1', 'p2'], incoming);
    expect(diff.keep.map((k) => k.id).sort()).toEqual(['p1', 'p2']);
    expect(diff.add).toHaveLength(1);
    expect(diff.add[0]!.paidAmount).toBe(300);
  });

  it('treats an unknown/absent id as an append (never a keep)', () => {
    const diff = diffOrderPayments(
      ['p1'],
      [{ id: 'ghost', paidAmount: 100 }, { paidAmount: 50 }],
    );
    expect(diff.keep).toHaveLength(0);
    expect(diff.add).toHaveLength(2);
  });

  it('has no remove partition — collected payments are never deleted on edit', () => {
    const diff = diffOrderPayments(
      ['p1', 'p2'],
      [{ id: 'p1', paidAmount: 500 }],
    );
    // 'p2' is simply absent from the result; it is preserved on the order, not removed.
    expect(diff.keep.map((k) => k.id)).toEqual(['p1']);
    expect(diff.add).toHaveLength(0);
    expect(diff).not.toHaveProperty('removeIds');
  });
});

describe('isTestDeletable', () => {
  it('allows removal when no report or only pending reports', () => {
    expect(isTestDeletable([])).toBe(true);
    expect(
      isTestDeletable([
        LabReportStatus.PENDING,
        LabReportStatus.PARTIAL_PENDING,
      ]),
    ).toBe(true);
  });
  it('blocks removal once any report is SAVED or beyond', () => {
    expect(
      isTestDeletable([LabReportStatus.PENDING, LabReportStatus.SAVED]),
    ).toBe(false);
    expect(isTestDeletable([LabReportStatus.VALIDATION_PENDING])).toBe(false);
    expect(isTestDeletable([LabReportStatus.RESULT_DONE])).toBe(false);
    expect(isTestDeletable([LabReportStatus.APPROVED])).toBe(false);
    expect(isTestDeletable([LabReportStatus.PUBLISHED])).toBe(false);
    expect(isTestDeletable([LabReportStatus.ERROR_REPORTED])).toBe(false);
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
