import {
  applyB2bLabReportScope,
  assertLabReportPanelOwnership,
} from './lab-report.service';
import { ReferralPanelAccessDeniedException } from '../../common/exceptions/referral-panel-access.exception';

describe('lab-report b2b isolation helpers', () => {
  it('nests orderItem.order.referralPanelId when a panel scope is active', () => {
    const where: Record<string, unknown> = {
      tenantId: 't1',
      branchId: 'b1',
      deletedAt: null,
    };
    applyB2bLabReportScope(where, 'panel-3');
    expect(where.orderItem).toEqual({ order: { referralPanelId: 'panel-3' } });
  });

  it('merges with an existing orderItem/order filter', () => {
    const where: Record<string, unknown> = {
      orderItem: { order: { branchId: 'b1' } },
    };
    applyB2bLabReportScope(where, 'panel-3');
    expect(where.orderItem).toEqual({
      order: { branchId: 'b1', referralPanelId: 'panel-3' },
    });
  });

  it('throws when the report traces to another panel', () => {
    expect(() =>
      assertLabReportPanelOwnership(
        { id: 'r1', orderItem: { order: { referralPanelId: 'other' } } },
        'panel-3',
      ),
    ).toThrow(ReferralPanelAccessDeniedException);
  });

  it('passes for the active panel', () => {
    expect(() =>
      assertLabReportPanelOwnership(
        { id: 'r1', orderItem: { order: { referralPanelId: 'panel-3' } } },
        'panel-3',
      ),
    ).not.toThrow();
  });
});
