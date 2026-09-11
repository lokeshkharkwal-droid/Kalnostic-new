import {
  roleBaselinePermissions,
  roleTemplateModules,
  B2B_PANEL_PERMISSION_KEYS,
  B2B_BASELINE_PERMISSION_KEYS,
} from './module-permissions.constant';

describe('b2b_referring_panel curated baseline', () => {
  it('exposes exactly the five allowed navigation keys', () => {
    expect([...B2B_PANEL_PERMISSION_KEYS].sort()).toEqual(
      [
        'finance:panel_navigation__view_billing',
        'finance:panel_navigation__view_invoices',
        'finance:panel_navigation__view_payments',
        'lab_operations:panel_navigation__view_reporting',
        'registration:panel_navigation__view_order_console',
      ].sort(),
    );
  });

  it('baseline is the curated view-only set (NOT the full module expansion)', () => {
    const baseline = roleBaselinePermissions('b2b_referring_panel');
    // The baseline is exactly the curated set: five nav keys + the page/list
    // view keys (incl. the reporting worklist status tabs) — never the full
    // per-module expansion.
    expect([...baseline].sort()).toEqual(
      [...B2B_BASELINE_PERMISSION_KEYS].sort(),
    );
    // The five sidebar nav keys are present.
    for (const key of B2B_PANEL_PERMISSION_KEYS) {
      expect(baseline.has(key)).toBe(true);
    }
    // The page-access view keys that make the screens render are present.
    expect(baseline.has('registration:order_console__view_only')).toBe(true);
    expect(baseline.has('finance:invoice__list_view_only')).toBe(true);
    expect(baseline.has('finance:payments__list_view_only')).toBe(true);
    // View-only by design: no create/action key leaks in.
    expect(
      baseline.has(
        'registration:create_order_patient_details__allow_create_order',
      ),
    ).toBe(false);
    // A sibling nav key exists in the catalogue but is NOT in the B2B baseline.
    expect(
      baseline.has('registration:panel_navigation__view_full_module'),
    ).toBe(false);
  });

  it('still links the three modules (drives moduleAllowed)', () => {
    expect(roleTemplateModules('b2b_referring_panel').sort()).toEqual([
      'finance',
      'lab_operations',
      'registration',
    ]);
  });

  it('a full-module role (receptionist) DOES hold the sibling nav key', () => {
    const receptionist = roleBaselinePermissions('receptionist');
    expect(
      receptionist.has('registration:panel_navigation__view_full_module'),
    ).toBe(true);
    expect(
      receptionist.has('registration:panel_navigation__view_order_console'),
    ).toBe(true);
  });
});
