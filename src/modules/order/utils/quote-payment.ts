import { OrderStatus } from '@prisma/client';
import { roundToTwoDecimalPlaces } from '../../../common/utils';
import { QuotationPaymentNotAllowedException } from '../exceptions/order.exceptions';

/**
 * A quotation is an estimate, not a bill, so it may not take NEW money — the
 * payment belongs on the order the quote is converted into (money left on the
 * quote is never applied to a bill, so the patient's dues would be wrong).
 *
 * `alreadyOnQuote` is what the quote already holds (old data may hold some). An
 * unchanged or lowered total is allowed so such a quote stays editable; only an
 * increase is rejected. Any non-quote status is never restricted here.
 * @throws QuotationPaymentNotAllowedException
 */
export function assertQuoteTakesNoNewMoney(
  status: OrderStatus | null | undefined,
  incomingPaid: number,
  alreadyOnQuote = 0,
): void {
  if (status !== OrderStatus.QUOTE) return;
  const incoming = roundToTwoDecimalPlaces(incomingPaid);
  if (incoming > roundToTwoDecimalPlaces(alreadyOnQuote)) {
    throw new QuotationPaymentNotAllowedException(incoming);
  }
}
