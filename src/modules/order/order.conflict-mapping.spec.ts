import { Prisma } from '@prisma/client';
import { OrderService } from './order.service';
import {
  OrderCodeConflictException,
  SourceQuotationInvalidException,
} from './exceptions/order.exceptions';

/**
 * `create()` reports a unique-constraint violation as "An order with this code
 * already exists". That is only true when the violated constraint is on the
 * `orders` table. A clash on another table inside the same transaction (e.g. a
 * payment row's primary key) must surface as itself, not be mislabelled.
 */
describe('OrderService — rethrowConflict', () => {
  const service = new OrderService(
    ...(Array(13).fill(undefined) as ConstructorParameters<
      typeof OrderService
    >),
  );
  const rethrow = (e: unknown, sourceQuotationId?: string) =>
    (
      service as unknown as {
        rethrowConflict: (e: unknown, sourceQuotationId?: string) => void;
      }
    ).rethrowConflict(e, sourceQuotationId);

  const p2002 = (meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta,
    });

  it('maps a unique violation on the orders table to ORDER_CODE_CONFLICT', () => {
    expect(() =>
      rethrow(
        p2002({ modelName: 'Order', target: ['tenant_id', 'order_code'] }),
      ),
    ).toThrow(OrderCodeConflictException);
  });

  it('keeps the old behaviour when Prisma gives no model name', () => {
    expect(() => rethrow(p2002({ target: ['order_code'] }))).toThrow(
      OrderCodeConflictException,
    );
    expect(() => rethrow(p2002())).toThrow(OrderCodeConflictException);
  });

  it('does NOT report a payment-row primary-key clash as an order-code conflict', () => {
    expect(() =>
      rethrow(p2002({ modelName: 'PaymentDetails', target: ['id'] })),
    ).not.toThrow();
  });

  it('ignores other Prisma errors and non-Prisma errors', () => {
    expect(() =>
      rethrow(
        new Prisma.PrismaClientKnownRequestError('x', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      ),
    ).not.toThrow();
    expect(() => rethrow(new Error('boom'))).not.toThrow();
  });

  const fk = (meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('Foreign key failed', {
      code: 'P2003',
      clientVersion: 'test',
      meta,
    });

  it('reports a Convert whose source quote does not exist as SOURCE_QUOTATION_INVALID', () => {
    expect(() =>
      rethrow(
        fk({
          modelName: 'Order',
          constraint: 'orders_source_quotation_id_fkey',
        }),
        'quote-1',
      ),
    ).toThrow(SourceQuotationInvalidException);
  });

  it('leaves other foreign-key failures, and a create with no source quote, untouched', () => {
    expect(() =>
      rethrow(
        fk({ modelName: 'Order', constraint: 'orders_patient_id_fkey' }),
        'quote-1',
      ),
    ).not.toThrow();
    expect(() =>
      rethrow(
        fk({
          modelName: 'Order',
          constraint: 'orders_source_quotation_id_fkey',
        }),
      ),
    ).not.toThrow();
  });
});
