import {
  roleBaselinePermissions,
  roleTemplateModules,
  B2B_PANEL_PERMISSION_KEYS,
} from './module-permissions.constant';

describe('b2b_referring_panel curated baseline', () => {
  it('exposes exactly the eight allowed keys (5 nav + 3 page-level view keys)', () => {
    expect([...B2B_PANEL_PERMISSION_KEYS].sort()).toEqual(
      [
        'finance:panel_navigation__view_billing',
        'finance:panel_navigation__view_invoices',
        'finance:panel_navigation__view_payments',
        'lab_operations:panel_navigation__view_reporting',
        'registration:panel_navigation__view_order_console',
        'registration:order_console__view_only',
        'finance:payments__list_view_only',
        'finance:invoice__list_view_only',
      ].sort(),
    );
  });

  it('baseline is the eight keys only (NOT the full module expansion)', () => {
    const baseline = roleBaselinePermissions('b2b_referring_panel');
    expect(baseline.size).toBe(8);
    expect(
      baseline.has('registration:panel_navigation__view_order_console'),
    ).toBe(true);
    expect(baseline.has('registration:order_console__view_only')).toBe(true);
    expect(baseline.has('finance:payments__list_view_only')).toBe(true);
    expect(baseline.has('finance:invoice__list_view_only')).toBe(true);
    // Order Console stays view-only for B2B — no order-creation permission.
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
