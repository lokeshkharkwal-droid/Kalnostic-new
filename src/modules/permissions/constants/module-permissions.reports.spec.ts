import {
  MODULE_PERMISSION_CATALOG,
  PERMISSION_KEYS,
  roleBaselinePermissions,
} from './module-permissions.constant';

/**
 * Business Admin → REPORT → WhatsApp Report / SMS Report. One view permission
 * per channel, catalogued under business_admin › Reports.
 */
describe('Business Admin messaging report permissions', () => {
  const whatsapp = PERMISSION_KEYS.BA_REPORTS_VIEW_WHATSAPP;
  const sms = PERMISSION_KEYS.BA_REPORTS_VIEW_SMS;

  it('the constants match the generated catalogue keys', () => {
    expect(whatsapp).toBe('business_admin:reports__view_whatsapp_report');
    expect(sms).toBe('business_admin:reports__view_sms_report');
    const entries = MODULE_PERMISSION_CATALOG.filter(
      (e) => e.permissionKey === whatsapp || e.permissionKey === sms,
    );
    expect(entries.map((e) => e.permissionKey).sort()).toEqual(
      [sms, whatsapp].sort(),
    );
    for (const e of entries) {
      expect(e.moduleKey).toBe('business_admin');
      expect(e.section).toBe('reports');
    }
  });

  it('a Business Admin holds both by default (no role change or migration needed)', () => {
    const baseline = roleBaselinePermissions('business_admin');
    expect(baseline.has(whatsapp)).toBe(true);
    expect(baseline.has(sms)).toBe(true);
  });

  it('branch-level roles do not hold them', () => {
    for (const role of ['branch_admin', 'lab_technician', 'receptionist']) {
      const baseline = roleBaselinePermissions(role);
      expect(baseline.has(whatsapp)).toBe(false);
      expect(baseline.has(sms)).toBe(false);
    }
  });
});
