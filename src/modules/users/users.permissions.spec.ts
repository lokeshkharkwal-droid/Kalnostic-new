import { UsersService } from './users.service';
import { ModuleNotAssignedToUserException } from './exceptions/users.exceptions';
import { MODULE_PERMISSION_CATALOG } from '../permissions/constants/module-permissions.constant';

/**
 * The modules assigned to a user at a branch (`UserBranchProfile.enabledModules`)
 * are a hard ceiling on access: a user-level or branch-role allow override for
 * any other module must NOT surface that module (the production bug where a
 * Branch Admin with one module saw every module in the top nav).
 *
 * Prisma is stubbed; only the reads these resolvers make are modelled.
 */
const TENANT = 't1';
const PERSON = 'p1';
const BRANCH = 'b1';
const ALL_BRANCH_MODULES = [
  'branch_admin',
  'business_admin',
  'registration',
  'accession',
  'finance',
];

/** Every catalogue key of a module, as allowed overrides. */
function allowAll(moduleKey: string) {
  return MODULE_PERMISSION_CATALOG.filter((e) => e.moduleKey === moduleKey).map(
    (e) => ({ moduleKey, permissionKey: e.permissionKey, allowed: true }),
  );
}

function firstKey(moduleKey: string): string {
  const entry = MODULE_PERMISSION_CATALOG.find(
    (e) => e.moduleKey === moduleKey,
  );
  if (!entry) throw new Error(`no catalogue entry for ${moduleKey}`);
  return entry.permissionKey;
}

function makeService(opts: {
  enabledModules: string[];
  userOverrides?: { permissionKey: string; allowed: boolean }[];
  branchRoleOverrides?: { permissionKey: string; allowed: boolean }[];
  hasProfile?: boolean;
}) {
  const profile = {
    id: 'ubp1',
    tenantId: TENANT,
    personId: PERSON,
    branchId: BRANCH,
    authRoleId: 'role-branch-admin',
    authRole: {
      id: 'role-branch-admin',
      key: 'branch_admin',
      name: 'Branch Admin',
    },
    enabledModules: opts.enabledModules,
  };
  const tx = {
    userBranchPermission: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    tenantStaffMembership: {
      findFirst: jest.fn().mockResolvedValue({ id: 'm1', authRole: null }),
    },
    branchModule: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          ALL_BRANCH_MODULES.map((moduleKey) => ({ moduleKey })),
        ),
    },
    userBranchProfile: {
      findMany: jest
        .fn()
        .mockResolvedValue(opts.hasProfile === false ? [] : [profile]),
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.hasProfile === false ? null : profile),
    },
    userBranchPermission: {
      findMany: jest.fn().mockResolvedValue(opts.userOverrides ?? []),
    },
    branchRolePermission: {
      findMany: jest.fn().mockResolvedValue(opts.branchRoleOverrides ?? []),
    },
    withTenant: jest.fn((_id: string, cb: (t: unknown) => unknown) => cb(tx)),
  };
  const branchService = {
    findById: jest.fn().mockResolvedValue({ id: BRANCH }),
  };
  const service = new UsersService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    branchService as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, tx };
}

const moduleKeysOf = (r: { modules: { moduleKey: string }[] }) =>
  r.modules.map((m) => m.moduleKey).sort();

describe('UsersService permissions — assigned modules are the ceiling', () => {
  describe('getMyPermissions', () => {
    it('shows only the assigned module despite allow overrides for others', async () => {
      const { service } = makeService({
        enabledModules: ['branch_admin'],
        userOverrides: [
          ...allowAll('registration'),
          ...allowAll('business_admin'),
          ...allowAll('finance'),
        ],
      });

      const res = await service.getMyPermissions(TENANT, PERSON, BRANCH);

      expect(moduleKeysOf(res)).toEqual(['branch_admin']);
      expect(res.allowed.every((k) => k.startsWith('branch_admin:'))).toBe(
        true,
      );
    });

    it('ignores branch-role allow overrides for unassigned modules', async () => {
      const { service } = makeService({
        enabledModules: ['branch_admin'],
        branchRoleOverrides: allowAll('accession'),
      });

      const res = await service.getMyPermissions(TENANT, PERSON, BRANCH);

      expect(moduleKeysOf(res)).toEqual(['branch_admin']);
    });

    it('returns every assigned module', async () => {
      const { service } = makeService({
        enabledModules: ['branch_admin', 'registration', 'finance'],
      });

      const res = await service.getMyPermissions(TENANT, PERSON, BRANCH);

      expect(moduleKeysOf(res)).toEqual([
        'branch_admin',
        'finance',
        'registration',
      ]);
    });

    it('still applies overrides inside an assigned module', async () => {
      const denied = firstKey('registration');
      const { service } = makeService({
        enabledModules: ['registration'],
        userOverrides: [{ permissionKey: denied, allowed: false }],
      });

      const res = await service.getMyPermissions(TENANT, PERSON, BRANCH);

      expect(moduleKeysOf(res)).toEqual(['registration']);
      expect(res.allowed).not.toContain(denied);
    });

    it('falls back to the role template when no modules are assigned', async () => {
      const { service } = makeService({
        enabledModules: [],
        userOverrides: allowAll('finance'),
      });

      const res = await service.getMyPermissions(TENANT, PERSON, BRANCH);

      // branch_admin's template is ['branch_admin'].
      expect(moduleKeysOf(res)).toEqual(['branch_admin']);
    });
  });

  describe('getBranchPermissions', () => {
    it('lists only assigned modules in the permission editor', async () => {
      const { service } = makeService({
        enabledModules: ['branch_admin', 'finance'],
        userOverrides: allowAll('registration'),
      });

      const rows = await service.getBranchPermissions(TENANT, PERSON, BRANCH);

      expect([...new Set(rows.map((r) => r.moduleKey))].sort()).toEqual([
        'branch_admin',
        'finance',
      ]);
    });
  });

  describe('updateBranchPermissions', () => {
    it('rejects an override for an unassigned module', async () => {
      const { service, tx } = makeService({ enabledModules: ['branch_admin'] });

      await expect(
        service.updateBranchPermissions(
          TENANT,
          PERSON,
          {
            branchId: BRANCH,
            items: [
              {
                moduleKey: 'registration',
                permissionKey: firstKey('registration'),
                allowed: true,
              },
            ],
          },
          'actor',
        ),
      ).rejects.toBeInstanceOf(ModuleNotAssignedToUserException);
      expect(tx.userBranchPermission.createMany).not.toHaveBeenCalled();
    });

    it('rejects any override when the user has no assignment at the branch', async () => {
      const { service } = makeService({
        enabledModules: [],
        hasProfile: false,
      });

      await expect(
        service.updateBranchPermissions(
          TENANT,
          PERSON,
          {
            branchId: BRANCH,
            items: [
              {
                moduleKey: 'branch_admin',
                permissionKey: firstKey('branch_admin'),
                allowed: true,
              },
            ],
          },
          'actor',
        ),
      ).rejects.toBeInstanceOf(ModuleNotAssignedToUserException);
    });

    it('accepts overrides inside assigned modules', async () => {
      const { service, tx } = makeService({ enabledModules: ['branch_admin'] });

      await service.updateBranchPermissions(
        TENANT,
        PERSON,
        {
          branchId: BRANCH,
          items: [
            {
              moduleKey: 'branch_admin',
              permissionKey: firstKey('branch_admin'),
              allowed: false,
            },
          ],
        },
        'actor',
      );

      expect(tx.userBranchPermission.deleteMany).toHaveBeenCalled();
      expect(tx.userBranchPermission.createMany).toHaveBeenCalledTimes(1);
    });
  });
});
