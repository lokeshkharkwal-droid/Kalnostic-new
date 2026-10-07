import { allowedModulesForRole } from './role-module-access.config';
import { SYSTEM_MODULE_KEYS } from './system-modules.constant';

describe('role → module assignment access', () => {
  // Role selection no longer restricts which modules may be assigned: every role
  // may be assigned every available module (the branch's own enablement is the
  // real limiter, enforced elsewhere).
  it.each([
    'b2b_referring_panel',
    'patient',
    'receptionist',
    'doctor',
    'business_admin',
    'some_unknown_tenant_custom_role',
  ])('offers every available module for role "%s"', (roleKey) => {
    expect(allowedModulesForRole(roleKey).sort()).toEqual(
      [...SYSTEM_MODULE_KEYS].sort(),
    );
  });
});
