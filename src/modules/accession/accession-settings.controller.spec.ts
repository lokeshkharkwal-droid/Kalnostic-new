import 'reflect-metadata';
import {
  BUSINESS_ANY_PERMISSIONS_KEY,
  BUSINESS_PERMISSIONS_KEY,
} from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { AccessionSettingsController } from './accession-settings.controller';
import { AccessionSettingsService } from './accession-settings.service';

/**
 * The `view/update accession settings` permissions guard the Accession
 * Settings PAGE only. The saved settings (Master Data lists, acceptance rules)
 * must still apply on the worklists for users who do not hold them — those
 * screens read `GET /accession/settings/effective`, which must stay ungated.
 * (The class-level `PermissionGuard` is opt-in: a route without
 * `@RequirePermission` is never gated.)
 */
describe('AccessionSettingsController — permissions control access, not the settings', () => {
  type Method = keyof AccessionSettingsController;
  const handler = (method: Method) =>
    Object.getOwnPropertyDescriptor(
      AccessionSettingsController.prototype,
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
        AccessionSettingsController,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        BUSINESS_ANY_PERMISSIONS_KEY,
        AccessionSettingsController,
      ),
    ).toBeUndefined();
  });

  it('the settings page endpoints keep their view/update permissions', () => {
    expect(required('get')).toEqual([PERMISSION_KEYS.ACC_SETTINGS_VIEW]);
    expect(required('save')).toEqual([PERMISSION_KEYS.ACC_SETTINGS_UPDATE]);
  });

  it('returns the same effective settings as the page, for the JWT tenant + branch', async () => {
    const effective = { MasterData_RejectionReasons: ['Hemolysed'] };
    const service = { getForBranch: jest.fn().mockResolvedValue(effective) };
    const controller = new AccessionSettingsController(
      service as unknown as AccessionSettingsService,
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
