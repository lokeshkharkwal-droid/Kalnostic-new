import { ForbiddenException } from '@nestjs/common';
import { B2bModuleGuard } from './b2b-module.guard';

function ctx(user: unknown, url: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, url, path: url.split('?')[0] }),
    }),
  } as never;
}

describe('B2bModuleGuard', () => {
  const guard = new B2bModuleGuard();
  const b2b = { active_profile_key: 'b2b_referring_panel', referral_panel_id: 'p1' };

  it('lets non-B2B users through any path', () => {
    expect(
      guard.canActivate(
        ctx({ active_profile_key: 'receptionist' }, '/api/v1/inventory'),
      ),
    ).toBe(true);
  });

  it('allows B2B users on allow-listed paths', () => {
    expect(guard.canActivate(ctx(b2b, '/api/v1/orders?page=1'))).toBe(true);
    expect(guard.canActivate(ctx(b2b, '/api/v1/finance/payments'))).toBe(true);
    expect(guard.canActivate(ctx(b2b, '/api/v1/lab-reports/abc'))).toBe(true);
  });

  it('rejects B2B users on non-allow-listed paths', () => {
    expect(() => guard.canActivate(ctx(b2b, '/api/v1/inventory'))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(ctx(b2b, '/api/v1/sales/leads'))).toThrow(
      ForbiddenException,
    );
  });
});
