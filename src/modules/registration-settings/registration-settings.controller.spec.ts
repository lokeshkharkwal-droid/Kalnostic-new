import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import {
  BUSINESS_ANY_PERMISSIONS_KEY,
  BUSINESS_PERMISSIONS_KEY,
} from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { RegistrationSettingsController } from './registration-settings.controller';
import { RegistrationSettingsService } from './registration-settings.service';
import { ExternalIdService } from './external-id.service';
import { EmergencyPricingService } from './emergency-pricing.service';

/**
 * The `view/update registration settings` permissions guard the Registration
 * Settings PAGE only. The saved settings must still apply on the operational
 * screens for users who do not hold them — those screens read
 * `GET /registration-settings/effective`, which therefore must stay ungated.
 */
describe('RegistrationSettingsController — permissions control access, not the settings', () => {
  type Method = keyof RegistrationSettingsController;
  const handler = (method: Method) =>
    Object.getOwnPropertyDescriptor(
      RegistrationSettingsController.prototype,
      method,
    )!.value as object;
  const required = (method: Method) =>
    Reflect.getMetadata(BUSINESS_PERMISSIONS_KEY, handler(method)) as
      | string[]
      | undefined;
  const guards = (method: Method) =>
    (Reflect.getMetadata(GUARDS_METADATA, handler(method)) ?? []) as unknown[];

  it('the effective-settings read is login-only (no permission, no guard)', () => {
    expect(required('getEffectiveSettings')).toBeUndefined();
    expect(
      Reflect.getMetadata(
        BUSINESS_ANY_PERMISSIONS_KEY,
        handler('getEffectiveSettings'),
      ),
    ).toBeUndefined();
    expect(guards('getEffectiveSettings')).not.toContain(PermissionGuard);
    // Nor gated at class level.
    expect(
      Reflect.getMetadata(BUSINESS_PERMISSIONS_KEY, RegistrationSettingsController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(GUARDS_METADATA, RegistrationSettingsController) ?? [],
    ).not.toContain(PermissionGuard);
  });

  it('the settings page endpoints keep their view/update permissions', () => {
    expect(required('getSettings')).toEqual([
      PERMISSION_KEYS.REGISTRATION_SETTINGS_VIEW,
    ]);
    expect(guards('getSettings')).toContain(PermissionGuard);
    expect(required('saveSettings')).toEqual([
      PERMISSION_KEYS.REGISTRATION_SETTINGS_UPDATE,
    ]);
    expect(guards('saveSettings')).toContain(PermissionGuard);
    expect(required('getBusinessSettings')).toEqual([
      PERMISSION_KEYS.REGISTRATION_SETTINGS_VIEW,
    ]);
    expect(required('saveBusinessSettings')).toEqual([
      PERMISSION_KEYS.REGISTRATION_SETTINGS_UPDATE,
    ]);
  });

  it('returns the same branch row the backend enforces with, for the JWT tenant + branch', async () => {
    const row = { id: 'r1', Patients_AllowB2bPatientWithoutMobile: true };
    const service = { getForBranch: jest.fn().mockResolvedValue(row) };
    const controller = new RegistrationSettingsController(
      service as unknown as RegistrationSettingsService,
      {} as ExternalIdService,
      {} as EmergencyPricingService,
    );

    await expect(
      controller.getEffectiveSettings('t1', {
        profileKey: 'lab_technician',
        branchId: 'b1',
      }),
    ).resolves.toBe(row);
    expect(service.getForBranch).toHaveBeenCalledWith('t1', 'b1');
  });
});
