import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../security/password.service';
import { UsernameGeneratorService } from '../security/username-generator.service';
import { EncryptionService } from '../security/encryption.service';
import { BranchService } from '../branch/branch.service';
import { AuthRoleService } from '../auth-role/auth-role.service';
import { UsersService } from './users.service';

/**
 * Unit coverage for `resolveEffectiveModules` (private, exercised via an
 * `as unknown` cast — see auth.service.spec.ts for the same pattern). The
 * regression guard: a curated role (`b2b_referring_panel`) must grant exactly
 * its curated permission keys instead of the full expansion of its assigned
 * modules, while an ordinary role (e.g. `receptionist`) keeps getting the full
 * per-module expansion unchanged — the bug this locks in was `resolveEffectiveModules`
 * ignoring `ROLE_TEMPLATES[...].curated` entirely and always full-expanding.
 */
describe('UsersService — resolveEffectiveModules', () => {
  let service: UsersService;

  beforeEach(() => {
    service = new UsersService(
      {} as unknown as PrismaService,
      {} as unknown as PasswordService,
      {} as unknown as UsernameGeneratorService,
      {} as unknown as EncryptionService,
      {} as unknown as BranchService,
      {} as unknown as AuthRoleService,
      {} as unknown as EventEmitter2,
      {} as unknown as ConfigService,
    );
  });

  const resolve = (roleKey: string, assignedModules: string[]) =>
    (
      service as unknown as {
        resolveEffectiveModules: (
          roleKey: string,
          assignedModules: string[],
        ) => { moduleKeys: Set<string>; permissions: Set<string> };
      }
    ).resolveEffectiveModules(roleKey, assignedModules);

  it('grants a curated role (b2b_referring_panel) exactly its 5 curated keys, not the full module expansion', () => {
    const { permissions } = resolve('b2b_referring_panel', [
      'registration',
      'finance',
      'lab_operations',
    ]);
    expect([...permissions].sort()).toEqual(
      [
        'finance:panel_navigation__view_billing',
        'finance:panel_navigation__view_invoices',
        'finance:panel_navigation__view_payments',
        'lab_operations:panel_navigation__view_reporting',
        'registration:panel_navigation__view_order_console',
      ].sort(),
    );
    // Regression guard: a sibling nav key in an assigned module must NOT leak in.
    expect(
      permissions.has('registration:panel_navigation__view_full_module'),
    ).toBe(false);
  });

  it('still gates a curated role by assigned modules (drops keys for unassigned modules)', () => {
    const { permissions } = resolve('b2b_referring_panel', ['finance']);
    expect([...permissions].sort()).toEqual(
      [
        'finance:panel_navigation__view_billing',
        'finance:panel_navigation__view_invoices',
        'finance:panel_navigation__view_payments',
      ].sort(),
    );
  });

  it('leaves a full-expansion role (receptionist) unaffected', () => {
    const { permissions } = resolve('receptionist', ['registration']);
    expect(
      permissions.has('registration:panel_navigation__view_full_module'),
    ).toBe(true);
    expect(
      permissions.has('registration:panel_navigation__view_order_console'),
    ).toBe(true);
  });
});
