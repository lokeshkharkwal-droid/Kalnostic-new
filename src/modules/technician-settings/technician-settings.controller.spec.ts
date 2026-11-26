import 'reflect-metadata';
import {
  BUSINESS_ANY_PERMISSIONS_KEY,
  BUSINESS_PERMISSIONS_KEY,
} from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { TechnicianSettingsController } from './technician-settings.controller';
import { TechnicianSettingsService } from './technician-settings.service';

/**
 * The `view/update laboratory settings` permissions guard the Laboratory
 * Settings PAGE only. The saved settings (Notes editability, signatory count,
 * TAT adjustment reasons) must still apply on the technician worklist for users
 * who do not hold them — those screens read `GET /technician-settings/effective`,
 * which must stay ungated.
 * (The class-level `PermissionGuard` is opt-in: a route without
 * `@RequirePermission` is never gated.)
 */
describe('TechnicianSettingsController — permissions control access, not the settings', () => {
  type Method = keyof TechnicianSettingsController;
  const handler = (method: Method) =>
    Object.getOwnPropertyDescriptor(
      TechnicianSettingsController.prototype,
      method,
    )!.value as object;
  const required = (method: Method) =>
    Reflect.getMetadata(BUSINESS_PERMISSIONS_KEY, handler(method)) as
      | string[]
      | undefined;

  it('the effective-settings read declares no permission (login-only)', () => {
    expect(required('getEffective')).toBeUndefined();
    expect(
      Reflect.getMetadata(
        BUSINESS_ANY_PERMISSIONS_KEY,
        handler('getEffective'),
      ),
    ).toBeUndefined();
    // Nor a class-level permission that would apply to every route.
    expect(
      Reflect.getMetadata(
        BUSINESS_PERMISSIONS_KEY,
        TechnicianSettingsController,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        BUSINESS_ANY_PERMISSIONS_KEY,
        TechnicianSettingsController,
      ),
    ).toBeUndefined();
  });

  it('the settings page endpoints keep their view/update permissions', () => {
    expect(required('get')).toEqual([PERMISSION_KEYS.LAB_SETTINGS_VIEW]);
    expect(required('save')).toEqual([PERMISSION_KEYS.LAB_SETTINGS_UPDATE]);
  });

  it('returns the same effective settings as the page, for the JWT tenant + branch', async () => {
    const effective = { tatAdjustmentReasons: ['QC Failure (saved)'] };
    const service = { getForBranch: jest.fn().mockResolvedValue(effective) };
    const controller = new TechnicianSettingsController(
      service as unknown as TechnicianSettingsService,
    );

    await expect(
      controller.getEffective('t1', {
        profileKey: 'lab_technician',
        branchId: 'b1',
      }),
    ).resolves.toBe(effective);
    expect(service.getForBranch).toHaveBeenCalledWith('t1', 'b1');
  });
});
