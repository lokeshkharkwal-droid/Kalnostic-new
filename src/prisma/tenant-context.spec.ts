import { tenantContext, getReferralPanelId } from './tenant-context';

describe('getReferralPanelId', () => {
  it('reads the referral panel id from the active store', () => {
    tenantContext.run({ tenantId: 't1', referralPanelId: 'panel-1' }, () => {
      expect(getReferralPanelId()).toBe('panel-1');
    });
  });

  it('returns undefined with no active store', () => {
    expect(getReferralPanelId()).toBeUndefined();
  });
});
