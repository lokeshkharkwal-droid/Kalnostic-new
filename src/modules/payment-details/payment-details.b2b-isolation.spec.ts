import { applyB2bPaymentOrderScope } from './payment-details.service';

describe('payment b2b isolation helper', () => {
  it('nests an order.referralPanelId filter when a panel scope is active', () => {
    const where: Record<string, unknown> = { tenantId: 't1', deletedAt: null };
    applyB2bPaymentOrderScope(where, 'panel-3');
    expect(where.order).toEqual({ referralPanelId: 'panel-3' });
  });

  it('merges with an existing order filter', () => {
    const where: Record<string, unknown> = {
      tenantId: 't1',
      order: { branchId: 'b1' },
    };
    applyB2bPaymentOrderScope(where, 'panel-3');
    expect(where.order).toEqual({ branchId: 'b1', referralPanelId: 'panel-3' });
  });

  it('is a no-op without a panel scope', () => {
    const where: Record<string, unknown> = { tenantId: 't1' };
    applyB2bPaymentOrderScope(where, undefined);
    expect(where.order).toBeUndefined();
  });
});
