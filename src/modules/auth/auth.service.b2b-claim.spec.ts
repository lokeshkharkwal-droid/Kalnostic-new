import { resolveReferralPanelClaim } from './auth.service';

describe('resolveReferralPanelClaim', () => {
  const profiles = [
    {
      branchId: 'br1',
      authRole: { key: 'b2b_referring_panel' },
      referralPanelId: 'panel-9',
    },
    {
      branchId: 'br1',
      authRole: { key: 'receptionist' },
      referralPanelId: null,
    },
  ];

  it('returns the panel id when the active profile is the B2B role', () => {
    expect(
      resolveReferralPanelClaim(profiles, 'br1', 'b2b_referring_panel'),
    ).toBe('panel-9');
  });

  it('returns null for a non-B2B active profile', () => {
    expect(
      resolveReferralPanelClaim(profiles, 'br1', 'receptionist'),
    ).toBeNull();
  });

  it('returns null when there is no active profile', () => {
    expect(resolveReferralPanelClaim(profiles, null, null)).toBeNull();
  });
});
