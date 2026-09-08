import { ForbiddenException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { tenantContext, TenantContextStore } from '../../prisma/tenant-context';

function ctx(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

/** A CallHandler whose handle() captures the active store when subscribed. */
function capturingHandler(capture: (s: TenantContextStore | undefined) => void) {
  return {
    handle: () =>
      new Observable((sub) => {
        capture(tenantContext.getStore());
        sub.next(null);
        sub.complete();
      }),
  } as never;
}

describe('TenantContextInterceptor (B2B panel scope)', () => {
  const interceptor = new TenantContextInterceptor();

  it('stashes referralPanelId for a B2B session', (done) => {
    let seen: TenantContextStore | undefined;
    interceptor
      .intercept(
        ctx({
          tenant_id: 't1',
          active_profile_key: 'b2b_referring_panel',
          referral_panel_id: 'panel-5',
        }),
        capturingHandler((s) => (seen = s)),
      )
      .subscribe({
        complete: () => {
          expect(seen?.tenantId).toBe('t1');
          expect(seen?.referralPanelId).toBe('panel-5');
          done();
        },
      });
  });

  it('leaves referralPanelId unset for a non-B2B session', (done) => {
    let seen: TenantContextStore | undefined;
    interceptor
      .intercept(
        ctx({ tenant_id: 't1', active_profile_key: 'receptionist' }),
        capturingHandler((s) => (seen = s)),
      )
      .subscribe({
        complete: () => {
          expect(seen?.referralPanelId).toBeUndefined();
          done();
        },
      });
  });

  it('rejects a B2B token with no panel id', () => {
    expect(() =>
      interceptor.intercept(
        ctx({
          tenant_id: 't1',
          active_profile_key: 'b2b_referring_panel',
          referral_panel_id: null,
        }),
        capturingHandler(() => undefined),
      ),
    ).toThrow(ForbiddenException);
  });
});
