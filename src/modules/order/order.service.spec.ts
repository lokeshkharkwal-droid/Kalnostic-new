import { DiscountMode, OrderStatus, RegistrationSetting } from '@prisma/client';
import { OrderService } from './order.service';
import { OrderItemDto } from './dto/order-item.dto';
import { OrderPaymentDto } from './dto/order-payment.dto';
import {
  OrderDiscountNotAllowedException,
  OrderDiscountOutOfRangeException,
  LineItemDiscountNotAllowedException,
  LineItemDiscountOutOfRangeException,
  TdsNotApplicableException,
  TdsOutOfRangeException,
} from './exceptions/order.exceptions';

/**
 * Unit coverage for the branch's TDS & Discount enforcement
 * (`assertDiscountAndTdsRules`) applied when finalizing an order — the API-level
 * mirror of the Registration Settings gating. The method is dependency-free, so
 * the service is instantiated with stubbed constructor args and the private
 * method is exercised directly.
 */
describe('OrderService — TDS & Discount rules', () => {
  // Instantiate with no-op deps: the validators under test read only their args.
  const service = new OrderService(
    ...(Array(8).fill(undefined) as never[]),
  );

  /** Build a full-ish settings row with sensible discount/TDS defaults. */
  const makeSettings = (
    overrides: Partial<RegistrationSetting> = {},
  ): RegistrationSetting =>
    ({
      ChargesAndDeductions_AllowDiscounts: true,
      ChargesAndDeductions_MinimumDiscountPercent: 5,
      ChargesAndDeductions_MaximumDiscountPercent: 20,
      ChargesAndDeductions_AllowLineItemDiscount: true,
      ChargesAndDeductions_MinimumLineItemDiscountPercent: 5,
      ChargesAndDeductions_MaximumLineItemDiscountPercent: 20,
      ChargesAndDeductions_TdsApplicable: true,
      ChargesAndDeductions_MinimumTdsPercent: 2,
      ChargesAndDeductions_MaximumTdsPercent: 5,
      ChargesAndDeductions_AllowOrderDiscountOnly: false,
      ChargesAndDeductions_AllowLineDiscountOnly: false,
      ChargesAndDeductions_AllowBothOrderAndLineDiscount: false,
      ...overrides,
    }) as RegistrationSetting;

  const itemKey = 'test-1';
  const itemPrices = new Map<string, number>([[itemKey, 1000]]);

  /** Invoke the private validator with defaults + overrides. */
  const run = (opts: {
    settings?: RegistrationSetting;
    items?: OrderItemDto[];
    payments?: OrderPaymentDto[];
  }) =>
    (
      service as unknown as {
        assertDiscountAndTdsRules: (p: unknown) => void;
      }
    ).assertDiscountAndTdsRules({
      status: OrderStatus.ORDER,
      branchId: 'b1',
      settings: opts.settings ?? makeSettings(),
      items: opts.items ?? [{ branchLabTestId: itemKey }],
      payments: opts.payments,
      itemPrices,
    });

  it('passes when nothing is discounted', () => {
    expect(() => run({})).not.toThrow();
  });

  it('is a no-op for non-ORDER statuses', () => {
    expect(() =>
      (
        service as unknown as {
          assertDiscountAndTdsRules: (p: unknown) => void;
        }
      ).assertDiscountAndTdsRules({
        status: OrderStatus.DRAFT,
        branchId: 'b1',
        settings: makeSettings({ ChargesAndDeductions_AllowDiscounts: false }),
        items: [{ branchLabTestId: itemKey, discount: 500 }],
        payments: [{ orderDiscount: 500 }],
        itemPrices,
      }),
    ).not.toThrow();
  });

  describe('line-item discount', () => {
    it('rejects a line discount when line discounts are disabled', () => {
      expect(() =>
        run({
          settings: makeSettings({
            ChargesAndDeductions_AllowLineItemDiscount: false,
          }),
          items: [
            {
              branchLabTestId: itemKey,
              discount: 100,
              discountMode: DiscountMode.PERCENT,
              discountValue: 10,
            },
          ],
        }),
      ).toThrow(LineItemDiscountNotAllowedException);
    });

    it('rejects a line discount above the maximum percentage', () => {
      expect(() =>
        run({
          items: [
            {
              branchLabTestId: itemKey,
              discount: 300,
              discountMode: DiscountMode.PERCENT,
              discountValue: 30, // max is 20
            },
          ],
        }),
      ).toThrow(LineItemDiscountOutOfRangeException);
    });

    it('rejects a line discount below the minimum percentage', () => {
      expect(() =>
        run({
          items: [
            {
              branchLabTestId: itemKey,
              discount: 10,
              discountMode: DiscountMode.PERCENT,
              discountValue: 1, // min is 5
            },
          ],
        }),
      ).toThrow(LineItemDiscountOutOfRangeException);
    });

    it('accepts an in-range AMOUNT-mode line discount (derives the %)', () => {
      expect(() =>
        run({
          items: [
            {
              branchLabTestId: itemKey,
              discount: 150, // 15% of 1000 → within [5,20]
              discountMode: DiscountMode.AMOUNT,
              discountValue: 150,
            },
          ],
        }),
      ).not.toThrow();
    });
  });

  describe('order-level discount', () => {
    it('rejects an order discount when order discounts are disabled', () => {
      expect(() =>
        run({
          settings: makeSettings({
            ChargesAndDeductions_AllowDiscounts: false,
          }),
          payments: [{ orderDiscount: 100 }],
        }),
      ).toThrow(OrderDiscountNotAllowedException);
    });

    it('rejects an order discount above the maximum percentage', () => {
      expect(() =>
        run({ payments: [{ orderDiscount: 300 }] }), // 30% of 1000, max 20
      ).toThrow(OrderDiscountOutOfRangeException);
    });

    it('accepts an in-range order discount', () => {
      expect(() =>
        run({ payments: [{ orderDiscount: 100 }] }), // 10% of 1000
      ).not.toThrow();
    });
  });

  describe('discount mode exclusivity', () => {
    it('Line-Only rejects an order discount but allows a line discount', () => {
      const settings = makeSettings({
        ChargesAndDeductions_AllowLineDiscountOnly: true,
      });
      expect(() =>
        run({ settings, payments: [{ orderDiscount: 100 }] }),
      ).toThrow(OrderDiscountNotAllowedException);
      expect(() =>
        run({
          settings,
          items: [
            {
              branchLabTestId: itemKey,
              discount: 100,
              discountMode: DiscountMode.PERCENT,
              discountValue: 10,
            },
          ],
        }),
      ).not.toThrow();
    });

    it('Order-Only rejects a line discount but allows an order discount', () => {
      const settings = makeSettings({
        ChargesAndDeductions_AllowOrderDiscountOnly: true,
      });
      expect(() =>
        run({
          settings,
          items: [
            {
              branchLabTestId: itemKey,
              discount: 100,
              discountMode: DiscountMode.PERCENT,
              discountValue: 10,
            },
          ],
        }),
      ).toThrow(LineItemDiscountNotAllowedException);
      expect(() =>
        run({ settings, payments: [{ orderDiscount: 100 }] }),
      ).not.toThrow();
    });
  });

  describe('TDS', () => {
    it('rejects TDS when it is not applicable', () => {
      expect(() =>
        run({
          settings: makeSettings({
            ChargesAndDeductions_TdsApplicable: false,
          }),
          payments: [{ tdsDeduction: 30 }],
        }),
      ).toThrow(TdsNotApplicableException);
    });

    it('rejects TDS above the maximum percentage', () => {
      // net = 1000 (no discount); 100/1000 = 10%, max is 5
      expect(() => run({ payments: [{ tdsDeduction: 100 }] })).toThrow(
        TdsOutOfRangeException,
      );
    });

    it('accepts in-range TDS computed against the net amount', () => {
      // net = 1000; 30/1000 = 3% → within [2,5]
      expect(() => run({ payments: [{ tdsDeduction: 30 }] })).not.toThrow();
    });
  });
});
