import { StaffStatus } from '@prisma/client';
import { UsersService } from './users.service';
import { NoModuleAccessAtBranchException } from './exceptions/users.exceptions';

/**
 * Branch-assignment rules for the Edit User flow:
 *  - an assignment must grant at least one module enabled at the branch;
 *  - `shouldRevokeUnlisted` makes the list the user's full branch set and
 *    revokes the rest in the same transaction;
 *  - revoking an assignment drops the user's overrides at that branch;
 *  - the edit form never receives assignments on a soft-deleted branch.
 *
 * Prisma is a small in-memory fake covering only the calls these paths make.
 */
const TENANT = 't1';
const PERSON = 'p1';
const ACTOR = 'admin';
const NZB = 'branch-nzb';
const ARMOOR = 'branch-armoor';
const EMPTY = 'branch-no-modules';

interface Row {
  [key: string]: unknown;
}

/** Equality / `in` / `notIn` / `not` matcher for the where clauses used here. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const ops = cond as { in?: unknown[]; notIn?: unknown[]; not?: unknown };
      if (ops.in && !ops.in.includes(row[key])) return false;
      if (ops.notIn && ops.notIn.includes(row[key])) return false;
      if ('not' in ops && row[key] === ops.not) return false;
      return true;
    }
    return cond === null ? row[key] == null : row[key] === cond;
  });
}

function makeService() {
  const role = (key: string) => ({
    id: `role-${key}`,
    key,
    name: key,
    isSystem: true,
    allowedBranchTypes: [],
    tenantId: null,
  });
  const db: Record<string, Row[]> = {
    branch: [
      {
        id: NZB,
        tenantId: TENANT,
        name: 'NZB',
        branchType: 'DIAGNOSTIC',
        deletedAt: null,
      },
      {
        id: ARMOOR,
        tenantId: TENANT,
        name: 'ARMOOR',
        branchType: 'DIAGNOSTIC',
        deletedAt: null,
      },
      {
        id: EMPTY,
        tenantId: TENANT,
        name: 'Empty CC',
        branchType: 'DIAGNOSTIC',
        deletedAt: null,
      },
    ],
    branchModule: [NZB, ARMOOR].flatMap((branchId) =>
      ['registration', 'sales', 'finance'].map((moduleKey) => ({
        tenantId: TENANT,
        branchId,
        moduleKey,
        isEnabled: true,
        deletedAt: null,
      })),
    ),
    userBranchProfile: [],
    userBranchPermission: [],
  };
  const model = (name: string) => ({
    findMany: jest.fn((a: { where?: Row } = {}) =>
      Promise.resolve(db[name]!.filter((r) => matches(r, a.where))),
    ),
    findFirst: jest.fn((a: { where?: Row } = {}) =>
      Promise.resolve(db[name]!.find((r) => matches(r, a.where)) ?? null),
    ),
    create: jest.fn(({ data }: { data: Row }) => {
      const row = {
        id: `${name}-${db[name]!.length}`,
        deletedAt: null,
        ...data,
      };
      db[name]!.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn(({ where, data }: { where: Row; data: Row }) => {
      const row = db[name]!.find((r) => matches(r, where));
      Object.assign(row ?? {}, data);
      return Promise.resolve(row);
    }),
    updateMany: jest.fn(({ where, data }: { where: Row; data: Row }) => {
      const rows = db[name]!.filter((r) => matches(r, where));
      rows.forEach((r) => Object.assign(r, data));
      return Promise.resolve({ count: rows.length });
    }),
    deleteMany: jest.fn(({ where }: { where: Row }) => {
      const before = db[name]!.length;
      db[name] = db[name]!.filter((r) => !matches(r, where));
      return Promise.resolve({ count: before - db[name].length });
    }),
  });
  const delegates = {
    branch: model('branch'),
    branchModule: model('branchModule'),
    userBranchProfile: model('userBranchProfile'),
    userBranchPermission: model('userBranchPermission'),
    person: {
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: PERSON, aadhaarNumber: null }),
    },
    personCredentials: { findUnique: jest.fn().mockResolvedValue(null) },
    tenantStaffMembership: {
      findFirst: jest.fn().mockResolvedValue({ id: 'm1', authRole: null }),
    },
  };
  const prisma = {
    ...delegates,
    withTenant: jest.fn((_t: string, cb: (tx: unknown) => unknown) =>
      cb(delegates),
    ),
  };
  const branchService = {
    findById: jest.fn((id: string) => {
      const b = db.branch!.find((r) => r.id === id && r.deletedAt === null);
      return b
        ? Promise.resolve(b)
        : Promise.reject(new Error('BranchNotFound'));
    }),
  };
  const authRoleService = {
    resolveByKey: jest.fn((_t: string, key: string) =>
      Promise.resolve(role(key)),
    ),
  };
  const service = new UsersService(
    prisma as never,
    {} as never,
    {} as never,
    { decrypt: jest.fn() } as never,
    branchService as never,
    authRoleService as never,
    { emitAsync: jest.fn().mockResolvedValue([]) } as never,
    {} as never,
  );
  // Seed include: { authRole } on profile reads.
  const withRole = (r: Row) => ({ ...r, authRole: role(String(r.roleKey)) });
  delegates.userBranchProfile.findMany.mockImplementation(
    (a: { where?: Row } = {}) =>
      Promise.resolve(
        db.userBranchProfile!.filter((r) => matches(r, a.where)).map(withRole),
      ),
  );
  return { service, db };
}

const assign = (branchId: string, role: string, modules: string[]) => ({
  branchId,
  role,
  modules,
});
const live = (db: Record<string, Row[]>) =>
  db
    .userBranchProfile!.filter((p) => p.deletedAt === null)
    .map((p) => p.branchId);

describe('UsersService branch assignments', () => {
  it('rejects an assignment that grants no module at the branch', async () => {
    const { service } = makeService();

    await expect(
      service.assignBranches(
        TENANT,
        PERSON,
        [assign(EMPTY, 'receptionist', [])],
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(NoModuleAccessAtBranchException);
  });

  it('accepts a role-default assignment when the default module is enabled', async () => {
    const { service, db } = makeService();

    await service.assignBranches(
      TENANT,
      PERSON,
      [assign(NZB, 'receptionist', [])],
      ACTOR,
    );

    expect(live(db)).toEqual([NZB]);
  });

  it('revokes unlisted branches and their overrides in the same save', async () => {
    const { service, db } = makeService();
    await service.assignBranches(
      TENANT,
      PERSON,
      [
        assign(NZB, 'receptionist', ['registration']),
        assign(ARMOOR, 'finance_manager', ['finance']),
      ],
      ACTOR,
    );
    db.userBranchPermission!.push({
      tenantId: TENANT,
      personId: PERSON,
      branchId: ARMOOR,
      moduleKey: 'finance',
      permissionKey: 'finance:x',
      allowed: false,
    });

    await service.assignBranches(
      TENANT,
      PERSON,
      [assign(NZB, 'receptionist', ['registration'])],
      ACTOR,
      true,
    );

    expect(live(db)).toEqual([NZB]);
    const armoor = db.userBranchProfile!.find((p) => p.branchId === ARMOOR);
    expect(armoor).toMatchObject({ isActive: false, revokedBy: ACTOR });
    expect(db.userBranchPermission).toHaveLength(0);
  });

  it('leaves unlisted branches alone without shouldRevokeUnlisted', async () => {
    const { service, db } = makeService();
    await service.assignBranches(
      TENANT,
      PERSON,
      [
        assign(NZB, 'receptionist', ['registration']),
        assign(ARMOOR, 'finance_manager', ['finance']),
      ],
      ACTOR,
    );

    await service.assignBranches(
      TENANT,
      PERSON,
      [assign(NZB, 'receptionist', ['sales'])],
      ACTOR,
    );

    expect(live(db).sort()).toEqual([ARMOOR, NZB].sort());
  });

  it('drops overrides when a single assignment is revoked', async () => {
    const { service, db } = makeService();
    await service.assignBranches(
      TENANT,
      PERSON,
      [assign(NZB, 'receptionist', ['registration'])],
      ACTOR,
    );
    db.userBranchPermission!.push({
      tenantId: TENANT,
      personId: PERSON,
      branchId: NZB,
      moduleKey: 'registration',
      permissionKey: 'registration:x',
      allowed: false,
    });

    await service.revokeBranchAssignment(TENANT, PERSON, NZB, ACTOR);

    expect(live(db)).toEqual([]);
    expect(db.userBranchPermission).toHaveLength(0);
  });

  it('omits assignments on a soft-deleted branch from the edit form', async () => {
    const { service, db } = makeService();
    await service.assignBranches(
      TENANT,
      PERSON,
      [
        assign(NZB, 'receptionist', ['registration']),
        assign(ARMOOR, 'finance_manager', ['finance']),
      ],
      ACTOR,
    );
    db.userBranchProfile!.forEach((p) => {
      p.isActive = true;
      p.branchStatus = StaffStatus.ACTIVE;
    });
    db.branch!.find((b) => b.id === ARMOOR)!.deletedAt = new Date();

    const detail = await service.getUser(TENANT, PERSON);

    expect(detail.branches.map((b) => b.branchId)).toEqual([NZB]);
  });
});
