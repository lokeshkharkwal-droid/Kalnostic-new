import {
  PERMISSION_KEYS,
  modulePermissionKeys,
  roleBaselinePermissions,
} from './module-permissions.constant';

/**
 * Abnormal Flag Logic v1.3: the "Change abnormal style" permission (who may pick any style in the Technician's Highlight
 * dropdown). It lives under Laboratory > Reporting, and — like every permission of a module — every role that has the
 * Laboratory module holds it by default, so nobody loses today's behaviour on release day; an admin can then switch it off for
 * a role or a person.
 */
const KEY = 'lab_operations:reporting__change_abnormal_style';

describe('the "Change abnormal style" permission', () => {
  it('has the key the frontend uses, under Laboratory > Reporting', () => {
    expect(PERMISSION_KEYS.LAB_CHANGE_ABNORMAL_STYLE).toBe(KEY);
    expect(modulePermissionKeys('lab_operations')).toContain(KEY);
  });

  it('is in no other module', () => {
    for (const moduleKey of [
      'registration',
      'accession',
      'business_admin',
      'branch_admin',
      'finance',
    ]) {
      expect(modulePermissionKeys(moduleKey)).not.toContain(KEY);
    }
  });

  it.each(['lab_technician', 'junior_lab_technician', 'senior_lab_technician'])(
    'is granted by default to the %s role',
    (role) => {
      expect(roleBaselinePermissions(role).has(KEY)).toBe(true);
    },
  );

  it('is NOT in the curated view-only baseline of a B2B referring panel', () => {
    expect(roleBaselinePermissions('b2b_referring_panel').has(KEY)).toBe(false);
  });

  it('is not granted to a role without the Laboratory module (a receptionist cannot change it)', () => {
    expect(roleBaselinePermissions('receptionist').has(KEY)).toBe(false);
  });
});
