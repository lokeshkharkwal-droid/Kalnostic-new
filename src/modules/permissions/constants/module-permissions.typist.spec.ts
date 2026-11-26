import {
  modulePermissionKeys,
  roleBaselinePermissions,
  roleTemplateModules,
} from './module-permissions.constant';
import { ROLE_BASELINE_MODULES } from './role-module-access.config';

describe('typist role template', () => {
  it('defaults to the whole Laboratory and Registration modules', () => {
    expect(ROLE_BASELINE_MODULES.typist).toEqual([
      'lab_operations',
      'registration',
    ]);
    expect(roleTemplateModules('typist')).toEqual([
      'lab_operations',
      'registration',
    ]);
  });

  it('baseline is the full expansion of both modules (like other roles)', () => {
    const expected = [
      ...modulePermissionKeys('lab_operations'),
      ...modulePermissionKeys('registration'),
    ].sort();
    expect([...roleBaselinePermissions('typist')].sort()).toEqual(expected);
    // Includes the full-module navigation keys, so every Technician and
    // Registration sidebar item shows.
    const baseline = roleBaselinePermissions('typist');
    expect(
      baseline.has('lab_operations:panel_navigation__view_full_module'),
    ).toBe(true);
    expect(
      baseline.has('registration:panel_navigation__view_full_module'),
    ).toBe(true);
  });

  it('grants nothing outside Laboratory and Registration', () => {
    for (const key of roleBaselinePermissions('typist')) {
      expect(
        key.startsWith('lab_operations:') || key.startsWith('registration:'),
      ).toBe(true);
    }
  });

  it('leaves the existing lab-technician template unchanged', () => {
    expect(roleTemplateModules('lab_technician')).toEqual([
      'accession',
      'lab_operations',
    ]);
  });
});
