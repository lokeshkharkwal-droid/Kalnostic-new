import { OrderStatus } from '@prisma/client';
import { resolveBillGenerated } from './order.entity';

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
