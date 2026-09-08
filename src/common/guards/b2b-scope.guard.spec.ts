import { ForbiddenException } from '@nestjs/common';
import { B2bScopeGuard } from './b2b-scope.guard';
import { tenantContext } from '../../prisma/tenant-context';

function ctx(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

describe('B2bScopeGuard', () => {
  const guard = new B2bScopeGuard();

  it('is a no-op for non-B2B users (no store mutation)', () => {
    tenantContext.run({ tenantId: 't1' }, () => {
      const ok = guard.canActivate(
        ctx({ active_profile_key: 'receptionist', referral_panel_id: null }),
      );
      expect(ok).toBe(true);
      expect(tenantContext.getStore()?.referralPanelId).toBeUndefined();
    });
  });

  it('writes the panel id into the store for B2B users', () => {
    tenantContext.run({ tenantId: 't1' }, () => {
      guard.canActivate(
        ctx({
          active_profile_key: 'b2b_referring_panel',
          referral_panel_id: 'panel-7',
        }),
      );
      expect(tenantContext.getStore()?.referralPanelId).toBe('panel-7');
    });
  });

  it('rejects a B2B token with no panel id', () => {
    tenantContext.run({ tenantId: 't1' }, () => {
      expect(() =>
        guard.canActivate(
          ctx({
            active_profile_key: 'b2b_referring_panel',
            referral_panel_id: null,
          }),
        ),
      ).toThrow(ForbiddenException);
    });
  });
});
