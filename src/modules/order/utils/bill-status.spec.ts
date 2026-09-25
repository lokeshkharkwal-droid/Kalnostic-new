import { OrderStatus } from '@prisma/client';
import { billStatusLabel } from './bill-status';

describe('billStatusLabel', () => {
  it('reads Cancelled for a cancelled order regardless of money', () => {
    // A cancelled order that was part-paid (stored paymentStatus PARTIALLY_PAID).
    expect(billStatusLabel(OrderStatus.CANCELLED, 1000, 1000, 0)).toBe(
      'Cancelled',
    );
    // A cancelled order that was fully refunded (stored NOT_PAID/FULLY_REFUNDED).
    expect(billStatusLabel(OrderStatus.CANCELLED, 2100, 0, 2100)).toBe(
      'Cancelled',
    );
  });

  it('reads Not Paid when nothing has been collected', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 1000, 0, 0)).toBe('Not Paid');
  });

  it('reads Partially Paid when some but not all of the net is collected', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 1000, 400, 0)).toBe(
      'Partially Paid',
    );
  });

  it('reads Paid when the net is fully collected', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 1000, 1000, 0)).toBe('Paid');
  });

  it('reads Paid when nothing is owed (Generate Bill = No / 100% discount)', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 0, 0, 0)).toBe('Paid');
  });

  it('reads Require Refund when overpaid and nothing refunded yet', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 800, 1000, 0)).toBe(
      'Require Refund',
    );
  });

  it('reads Partially Refunded when overpaid and part of the refund is paid', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 800, 900, 100)).toBe(
      'Partially Refunded',
    );
  });

  it('reads Fully Refunded when a refund settled the order exactly at its net', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 800, 800, 200)).toBe(
      'Fully Refunded',
    );
  });

  it('ignores sub-paisa float noise when checking settlement', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 0.1 + 0.2, 0.3, 0)).toBe('Paid');
  });
});
