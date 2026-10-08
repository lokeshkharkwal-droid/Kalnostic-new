import { OrderStatus } from '@prisma/client';
import { assertQuoteTakesNoNewMoney } from './quote-payment';
import { QuotationPaymentNotAllowedException } from '../exceptions/order.exceptions';

describe('assertQuoteTakesNoNewMoney', () => {
  it('refuses any money on a new quote', () => {
    expect(() => assertQuoteTakesNoNewMoney(OrderStatus.QUOTE, 100)).toThrow(
      QuotationPaymentNotAllowedException,
    );
    expect(() => assertQuoteTakesNoNewMoney(OrderStatus.QUOTE, 0.01)).toThrow(
      QuotationPaymentNotAllowedException,
    );
  });

  it('allows a quote with no money (the normal ₹0 snapshot row)', () => {
    expect(() =>
      assertQuoteTakesNoNewMoney(OrderStatus.QUOTE, 0),
    ).not.toThrow();
    expect(() =>
      assertQuoteTakesNoNewMoney(OrderStatus.QUOTE, 0, 0),
    ).not.toThrow();
  });

  it('lets a quote that already holds money be re-saved unchanged (old data stays editable)', () => {
    expect(() =>
      assertQuoteTakesNoNewMoney(OrderStatus.QUOTE, 100, 100),
    ).not.toThrow();
  });

  it('lets that quote go down, but not up', () => {
    expect(() =>
      assertQuoteTakesNoNewMoney(OrderStatus.QUOTE, 40, 100),
    ).not.toThrow();
    expect(() =>
      assertQuoteTakesNoNewMoney(OrderStatus.QUOTE, 150, 100),
    ).toThrow(QuotationPaymentNotAllowedException);
  });

  it('ignores paisa rounding noise around the stored amount', () => {
    expect(() =>
      assertQuoteTakesNoNewMoney(OrderStatus.QUOTE, 100.004, 100),
    ).not.toThrow();
  });

  it.each([
    OrderStatus.DRAFT,
    OrderStatus.ORDER,
    OrderStatus.APPOINTMENT,
    OrderStatus.CANCELLED,
  ])('never restricts a %s', (status) => {
    expect(() => assertQuoteTakesNoNewMoney(status, 5000)).not.toThrow();
  });

  it('does nothing when the status is unknown', () => {
    expect(() => assertQuoteTakesNoNewMoney(undefined, 100)).not.toThrow();
    expect(() => assertQuoteTakesNoNewMoney(null, 100)).not.toThrow();
  });
});
