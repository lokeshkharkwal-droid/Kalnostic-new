import {
  MODULE_PERMISSION_CATALOG,
  PERMISSION_KEYS,
  roleBaselinePermissions,
} from './module-permissions.constant';

/**
 * Branch Settings (the "choose which Notes sections print" switches) belong to the
 * Branch Admin, not to lab staff who edit Technician settings.
 */
describe('Branch Settings permissions', () => {
  const view = PERMISSION_KEYS.BR_SETTINGS_VIEW;
  const update = PERMISSION_KEYS.BR_SETTINGS_UPDATE;

  it('the two keys exist in the catalogue under the branch_admin module', () => {
    const entries = MODULE_PERMISSION_CATALOG.filter(
      (e) => e.permissionKey === view || e.permissionKey === update,
    );
    expect(entries.map((e) => e.permissionKey).sort()).toEqual(
      [view, update].sort(),
    );
    for (const e of entries) {
      expect(e.moduleKey).toBe('branch_admin');
      expect(e.section).toBe('branch_settings');
    }
  });

  it('a Branch Admin holds both by default (no role change or migration needed)', () => {
    const baseline = roleBaselinePermissions('branch_admin');
    expect(baseline.has(view)).toBe(true);
    expect(baseline.has(update)).toBe(true);
  });

  it('lab technicians do not hold either, so they cannot change a branch-wide setting', () => {
    for (const role of [
      'lab_technician',
      'senior_lab_technician',
      'junior_lab_technician',
    ]) {
      const baseline = roleBaselinePermissions(role);
      expect(baseline.has(view)).toBe(false);
      expect(baseline.has(update)).toBe(false);
    }
  });

  it('Registration and Accession roles do not hold them either', () => {
    for (const role of ['receptionist', 'phlebotomist']) {
      const baseline = roleBaselinePermissions(role);
      expect(baseline.has(view)).toBe(false);
      expect(baseline.has(update)).toBe(false);
    }
  });
});
