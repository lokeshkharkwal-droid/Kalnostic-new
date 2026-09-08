import {
  applyB2bOrderScope,
  assertOrderPanelOwnership,
} from './order.service';
import { ReferralPanelAccessDeniedException } from '../../common/exceptions/referral-panel-access.exception';

describe('order b2b isolation helpers', () => {
  it('forces the referralPanelId filter when a panel scope is active', () => {
    const where: Record<string, unknown> = { tenantId: 't1', deletedAt: null };
    applyB2bOrderScope(where, 'panel-3');
    expect(where.referralPanelId).toBe('panel-3');
  });

  it('leaves the where untouched with no panel scope', () => {
    const where: Record<string, unknown> = { tenantId: 't1', deletedAt: null };
    applyB2bOrderScope(where, undefined);
    expect(where.referralPanelId).toBeUndefined();
  });

  it('throws when an order belongs to another panel', () => {
    expect(() =>
      assertOrderPanelOwnership({ id: 'o1', referralPanelId: 'other' }, 'panel-3'),
    ).toThrow(ReferralPanelAccessDeniedException);
  });

  it('passes when the order belongs to the active panel', () => {
    expect(() =>
      assertOrderPanelOwnership(
        { id: 'o1', referralPanelId: 'panel-3' },
        'panel-3',
      ),
    ).not.toThrow();
  });

  it('is a no-op ownership check when no panel scope is active', () => {
    expect(() =>
      assertOrderPanelOwnership({ id: 'o1', referralPanelId: 'anything' }, undefined),
    ).not.toThrow();
  });
});
