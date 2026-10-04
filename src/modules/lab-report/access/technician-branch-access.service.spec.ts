import { LabReportStatus } from '@prisma/client';
import { PERMISSION_KEYS } from '../../permissions/constants/module-permissions.constant';
import {
  ActiveBranchRequiredException,
  BranchNotAccessibleException,
} from '../exceptions/lab-report.exceptions';
import { TechnicianBranchAccessService } from './technician-branch-access.service';

const TENANT = 't1';
const PERSON = 'p1';
const A = 'branch-A';
const B = 'branch-B';
const C = 'branch-C';
const D = 'branch-D';
const E = 'branch-E';
const ACTIVE = { branchId: A, profileKey: 'lab_technician' };

type Setup = {
  /** Branches the person holds an (already DB-filtered) Technician profile in. */
  profiles: Array<{ branchId: string; role?: string }>;
  /** Branches that are active in the tenant. */
  activeBranches: string[];
  /** Branches where the Technician module is enabled. */
  moduleOn: string[];
  /** Permission keys per branch (independent per branch). */
  permissions: Record<string, string[]>;
  /** Branches that have sent samples another branch accepted. */
  sentBy?: string[];
  /** What the per-report sender-link lookup finds (when asked). */
  linkedReport?: boolean;
};

function build(setup: Setup) {
  const prisma = {
    userBranchProfile: {
      findMany: jest.fn().mockResolvedValue(
        setup.profiles.map((p) => ({
          branchId: p.branchId,
          authRole: { key: p.role ?? 'lab_technician' },
        })),
      ),
    },
    branch: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in
            .filter((id) => setup.activeBranches.includes(id))
            .map((id) => ({ id, name: `Name ${id}` })),
        ),
      ),
    },
    branchModule: {
      findMany: jest.fn(
        ({ where }: { where: { branchId: { in: string[] } } }) =>
          Promise.resolve(
            where.branchId.in
              .filter((id) => setup.moduleOn.includes(id))
              .map((branchId) => ({ branchId })),
          ),
      ),
    },
    sampleTransfer: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          (setup.sentBy ?? []).map((branchId) => ({ branchId })),
        ),
    },
    labReport: {
      findFirst: jest
        .fn()
        .mockResolvedValue(setup.linkedReport ? { id: 'r1' } : null),
    },
    runWithTenant: jest.fn((_t: string, fn: () => Promise<unknown>) => fn()),
  };
  const users = {
    getEffectivePermissionKeys: jest.fn((_t: string, _p: string, b: string) =>
      Promise.resolve(new Set(setup.permissions[b] ?? [])),
    ),
  };
  const svc = new TechnicianBranchAccessService(
    prisma as never,
    users as never,
  );
  return { svc, prisma, users };
}

const K = PERMISSION_KEYS;
const FULL = [
  K.LAB_ACCESS_PENDING,
  K.LAB_ACCESS_SAVED,
  K.LAB_ACCESS_APPROVED,
  K.LAB_ENTER_RESULT,
];

describe('TechnicianBranchAccessService — which branches', () => {
  it('(4) All Branches = own branch + every authorised branch, and nothing else', async () => {
    const { svc } = build({
      profiles: [{ branchId: B }, { branchId: C }, { branchId: D }],
      activeBranches: [A, B, C, D, E],
      moduleOn: [A, B, C, D, E],
      permissions: { [B]: FULL, [C]: FULL, [D]: FULL },
    });
    const scope = await svc.resolveScope(TENANT, PERSON, ACTIVE, 'all');
    expect(scope.rules.map((r) => r.branchId).sort()).toEqual([A, B, C, D]);
    // branch E exists and has the module, but the person has no profile there
    expect(scope.rules.map((r) => r.branchId)).not.toContain(E);
  });

  it('(12) a technician with no cross-branch access only ever gets his own branch', async () => {
    const { svc } = build({
      profiles: [],
      activeBranches: [A, B, C],
      moduleOn: [A, B, C],
      permissions: {},
    });
    const scope = await svc.resolveScope(TENANT, PERSON, ACTIVE, 'all');
    expect(scope.rules.map((r) => r.branchId)).toEqual([A]);
  });

  it('(5) a specific branch returns only that branch', async () => {
    const { svc } = build({
      profiles: [{ branchId: B }, { branchId: C }, { branchId: D }],
      activeBranches: [A, B, C, D],
      moduleOn: [A, B, C, D],
      permissions: { [B]: FULL, [C]: FULL, [D]: FULL },
    });
    const scope = await svc.resolveScope(TENANT, PERSON, ACTIVE, B);
    expect(scope.rules.map((r) => r.branchId)).toEqual([B]);
  });

  it('(4/5) a branch outside the authorised set is refused, not silently shown', async () => {
    const { svc } = build({
      profiles: [{ branchId: B }],
      activeBranches: [A, B, E],
      moduleOn: [A, B, E],
      permissions: { [B]: FULL },
    });
    await expect(svc.resolveScope(TENANT, PERSON, ACTIVE, E)).rejects.toThrow(
      BranchNotAccessibleException,
    );
  });

  it('(6/11) no Technician-module access at a branch: it is excluded even with a profile there', async () => {
    const { svc, prisma } = build({
      profiles: [{ branchId: B }, { branchId: C }],
      activeBranches: [A, B, C],
      moduleOn: [A, C], // module NOT enabled for B
      permissions: { [B]: FULL, [C]: FULL },
    });
    const scope = await svc.resolveScope(TENANT, PERSON, ACTIVE, 'all');
    expect(scope.rules.map((r) => r.branchId).sort()).toEqual([A, C]);
    // the profile query itself requires the module in the profile's enabledModules
    const where = (
      prisma.userBranchProfile.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ]
    )[0].where;
    expect(where).toMatchObject({
      tenantId: TENANT,
      personId: PERSON,
      deletedAt: null,
      isActive: true,
      branchStatus: 'ACTIVE',
      enabledModules: { has: 'lab_operations' },
    });
  });

  it('(10) a branch that is no longer active (or whose access was removed) disappears from All Branches', async () => {
    const { svc } = build({
      profiles: [{ branchId: B }, { branchId: C }],
      activeBranches: [A, C], // B deactivated
      moduleOn: [A, B, C],
      permissions: { [B]: FULL, [C]: FULL },
    });
    const scope = await svc.resolveScope(TENANT, PERSON, ACTIVE, 'all');
    expect(scope.rules.map((r) => r.branchId).sort()).toEqual([A, C]);
    await expect(svc.resolveScope(TENANT, PERSON, ACTIVE, B)).rejects.toThrow(
      BranchNotAccessibleException,
    );
  });

  it('(8) the own branch is always included and fully visible, whatever the profile says', async () => {
    const { svc } = build({
      profiles: [{ branchId: B }], // note: no profile row listed for A
      activeBranches: [B], // A not even in the branch lookup
      moduleOn: [B],
      permissions: { [B]: [K.LAB_ACCESS_PENDING] },
    });
    const access = await svc.resolve(TENANT, PERSON, ACTIVE);
    const own = access.find((a) => a.branchId === A);
    expect(own).toBeDefined();
    expect(own?.isActiveBranch).toBe(true);
    expect(own?.visibleStatuses).toBe('ALL');
    expect(access[0]?.branchId).toBe(A); // own branch first
  });

  it('with no branch requested the default is the own branch only (no cross-branch lookup)', async () => {
    const { svc, prisma } = build({
      profiles: [{ branchId: B }],
      activeBranches: [A, B],
      moduleOn: [A, B],
      permissions: { [B]: FULL },
    });
    const scope = await svc.resolveScope(TENANT, PERSON, ACTIVE, undefined);
    expect(scope).toEqual({
      rules: [{ branchId: A, statuses: 'ALL', senderLinked: false }],
    });
    expect(prisma.userBranchProfile.findMany).not.toHaveBeenCalled();
  });

  it('with neither a requested nor an active branch it asks for an active branch', async () => {
    const { svc } = build({
      profiles: [],
      activeBranches: [],
      moduleOn: [],
      permissions: {},
    });
    await expect(
      svc.resolveScope(
        TENANT,
        PERSON,
        { branchId: null, profileKey: 'business_admin' },
        undefined,
      ),
    ).rejects.toThrow(ActiveBranchRequiredException);
  });
});

describe('TechnicianBranchAccessService — permissions stay per branch', () => {
  const setup: Setup = {
    profiles: [{ branchId: B }, { branchId: C }, { branchId: D }],
    activeBranches: [A, B, C, D],
    moduleOn: [A, B, C, D],
    permissions: {
      [A]: [K.LAB_ACCESS_PENDING, K.LAB_ACCESS_SAVED, K.LAB_ACCESS_APPROVED],
      [B]: [K.LAB_ACCESS_PENDING, K.LAB_ACCESS_SAVED],
      [C]: [
        K.LAB_ACCESS_PENDING,
        K.LAB_ACCESS_SAVED,
        K.LAB_ACCESS_VALIDATION_PENDING,
      ],
      [D]: [], // module access but no report permissions at all
    },
  };

  it('(9) each branch contributes only the statuses ITS permissions grant', async () => {
    const { svc } = build(setup);
    const scope = await svc.resolveScope(TENANT, PERSON, ACTIVE, 'all');
    const byBranch = new Map(scope.rules.map((r) => [r.branchId, r.statuses]));
    // Own branch: unchanged — every status.
    expect(byBranch.get(A)).toBe('ALL');
    // B: Pending + Saved only — Branch A's Approved permission is NOT applied.
    expect([...(byBranch.get(B) as Set<LabReportStatus>)].sort()).toEqual([
      LabReportStatus.PENDING,
      LabReportStatus.SAVED,
    ]);
    // C: Pending + Saved + Validation Pending — nothing B or A has leaks in.
    expect([...(byBranch.get(C) as Set<LabReportStatus>)].sort()).toEqual([
      LabReportStatus.PENDING,
      LabReportStatus.SAVED,
      LabReportStatus.VALIDATION_PENDING,
    ]);
    // D: authorised branch, but no status granted -> no visible statuses.
    expect((byBranch.get(D) as Set<LabReportStatus>).size).toBe(0);
  });

  it('permissions are looked up separately for every branch, never reused', async () => {
    const { svc, users } = build(setup);
    await svc.resolve(TENANT, PERSON, ACTIVE);
    const asked = users.getEffectivePermissionKeys.mock.calls.map((c) => c[2]);
    expect([...asked].sort()).toEqual([A, B, C, D]);
  });

  it('(7) module access with no report permissions can reach the branch but see/do nothing extra', async () => {
    const { svc } = build(setup);
    const access = await svc.resolve(TENANT, PERSON, ACTIVE);
    const d = access.find((a) => a.branchId === D);
    expect(d).toBeDefined(); // branch + module access: reachable
    expect(d?.permissions.has(K.LAB_ENTER_RESULT)).toBe(false); // no operations
    expect((d?.visibleStatuses as Set<LabReportStatus>).size).toBe(0);
  });

  it('an admin role at a branch sees every status there', async () => {
    const { svc } = build({
      profiles: [{ branchId: B, role: 'administrator' }],
      activeBranches: [A, B],
      moduleOn: [A, B],
      permissions: { [B]: [] },
    });
    const access = await svc.resolve(TENANT, PERSON, ACTIVE);
    const b = access.find((x) => x.branchId === B);
    expect(b?.isAdmin).toBe(true);
    expect(b?.visibleStatuses).toBe('ALL');
  });
});

describe('TechnicianBranchAccessService — special worklists', () => {
  it('a cross-branch branch is included only where the list permission is held THERE', async () => {
    const { svc } = build({
      profiles: [{ branchId: B }, { branchId: C }],
      activeBranches: [A, B, C],
      moduleOn: [A, B, C],
      permissions: {
        [B]: [K.LAB_ACCESS_CRITICAL_LIST],
        [C]: [K.LAB_ACCESS_PENDING], // no critical-alert list access at C
      },
    });
    const scope = await svc.resolveScope(
      TENANT,
      PERSON,
      ACTIVE,
      'all',
      K.LAB_ACCESS_CRITICAL_LIST,
    );
    // own branch always; B has the key; C does not
    expect(scope.rules.map((r) => r.branchId).sort()).toEqual([A, B]);
  });

  it('naming a branch where the list permission is missing is refused', async () => {
    const { svc } = build({
      profiles: [{ branchId: C }],
      activeBranches: [A, C],
      moduleOn: [A, C],
      permissions: { [C]: [K.LAB_ACCESS_PENDING] },
    });
    await expect(
      svc.resolveScope(TENANT, PERSON, ACTIVE, C, K.LAB_ACCESS_CRITICAL_LIST),
    ).rejects.toThrow(BranchNotAccessibleException);
  });
});

describe('TechnicianBranchAccessService.canSee', () => {
  it('returns the branch access only when the status is visible at that branch', async () => {
    const { svc } = build({
      profiles: [{ branchId: B }],
      activeBranches: [A, B],
      moduleOn: [A, B],
      permissions: { [B]: [K.LAB_ACCESS_PENDING, K.LAB_ACCESS_SAVED] },
    });
    expect(
      await svc.canSee(TENANT, PERSON, ACTIVE, B, LabReportStatus.SAVED),
    ).not.toBeNull();
    // Approved is NOT granted at B, so a B report in Approved stays out of reach
    expect(
      await svc.canSee(TENANT, PERSON, ACTIVE, B, LabReportStatus.APPROVED),
    ).toBeNull();
    // a branch the person has no access to
    expect(
      await svc.canSee(TENANT, PERSON, ACTIVE, E, LabReportStatus.SAVED),
    ).toBeNull();
  });
});

describe('TechnicianBranchAccessService — edge cases', () => {
  it('"ALL" in any letter case means all authorised branches', async () => {
    const { svc } = build({
      profiles: [{ branchId: B }],
      activeBranches: [A, B],
      moduleOn: [A, B],
      permissions: { [B]: FULL },
    });
    for (const spelling of ['all', 'ALL', 'All']) {
      const scope = await svc.resolveScope(TENANT, PERSON, ACTIVE, spelling);
      expect(scope.rules.map((r) => r.branchId).sort()).toEqual([A, B]);
    }
  });

  it('naming the own branch explicitly behaves like the default (all statuses)', async () => {
    const { svc } = build({
      profiles: [],
      activeBranches: [A],
      moduleOn: [A],
      permissions: {},
    });
    const scope = await svc.resolveScope(TENANT, PERSON, ACTIVE, A);
    expect(scope.rules).toEqual([
      { branchId: A, statuses: 'ALL', senderLinked: false },
    ]);
  });

  it('a branch that is deactivated in the tenant drops out of All Branches', async () => {
    const { svc } = build({
      profiles: [{ branchId: B }, { branchId: C }],
      activeBranches: [A, B], // C is no longer an ACTIVE branch
      moduleOn: [A, B, C],
      permissions: { [B]: FULL, [C]: FULL },
    });
    const scope = await svc.resolveScope(TENANT, PERSON, ACTIVE, 'all');
    expect(scope.rules.map((r) => r.branchId).sort()).toEqual([A, B]);
    await expect(svc.resolveScope(TENANT, PERSON, ACTIVE, C)).rejects.toThrow(
      BranchNotAccessibleException,
    );
  });

  it('a branch whose Technician module is switched off drops out', async () => {
    const { svc } = build({
      profiles: [{ branchId: B }],
      activeBranches: [A, B],
      moduleOn: [A], // module off at B
      permissions: { [B]: FULL },
    });
    const scope = await svc.resolveScope(TENANT, PERSON, ACTIVE, 'all');
    expect(scope.rules.map((r) => r.branchId)).toEqual([A]);
  });

  it('an admin role at another branch passes the special-list permission check without holding the key', async () => {
    const { svc } = build({
      profiles: [{ branchId: B, role: 'business_admin' }],
      activeBranches: [A, B],
      moduleOn: [A, B],
      permissions: { [B]: [] },
    });
    const scope = await svc.resolveScope(
      TENANT,
      PERSON,
      ACTIVE,
      B,
      K.LAB_ACCESS_CRITICAL_LIST,
    );
    expect(scope.rules).toEqual([
      { branchId: B, statuses: 'ALL', senderLinked: false },
    ]);
  });

  it('branches are listed own-first, then alphabetically — a stable dropdown order', async () => {
    const { svc } = build({
      profiles: [{ branchId: D }, { branchId: B }, { branchId: C }],
      activeBranches: [A, B, C, D],
      moduleOn: [A, B, C, D],
      permissions: { [B]: FULL, [C]: FULL, [D]: FULL },
    });
    const access = await svc.resolve(TENANT, PERSON, ACTIVE);
    expect(access.map((a) => a.branchId)).toEqual([A, B, C, D]);
    expect(access[0]?.isActiveBranch).toBe(true);
    expect(access.slice(1).every((a) => !a.isActiveBranch)).toBe(true);
  });

  it("the role used at a branch is the profile held THERE, not the active profile's", async () => {
    const { svc } = build({
      profiles: [{ branchId: B, role: 'lab_supervisor' }],
      activeBranches: [A, B],
      moduleOn: [A, B],
      permissions: { [B]: FULL },
    });
    const access = await svc.resolve(TENANT, PERSON, ACTIVE);
    expect(access.find((a) => a.branchId === B)?.profileKey).toBe(
      'lab_supervisor',
    );
    expect(access.find((a) => a.branchId === A)?.profileKey).toBe(
      'lab_technician',
    );
  });

  it('every request re-reads the database (revoked access is gone on the very next call)', async () => {
    const { svc, prisma } = build({
      profiles: [{ branchId: B }],
      activeBranches: [A, B],
      moduleOn: [A, B],
      permissions: { [B]: FULL },
    });
    await svc.resolve(TENANT, PERSON, ACTIVE);
    await svc.resolve(TENANT, PERSON, ACTIVE);
    expect(prisma.userBranchProfile.findMany).toHaveBeenCalledTimes(2);
  });

  it('the profile lookup itself only accepts active, non-deleted Technician-module profiles', async () => {
    const { svc, prisma } = build({
      profiles: [],
      activeBranches: [A],
      moduleOn: [A],
      permissions: {},
    });
    await svc.resolve(TENANT, PERSON, ACTIVE);
    const arg = prisma.userBranchProfile.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(arg[0].where).toMatchObject({
      tenantId: TENANT,
      personId: PERSON,
      deletedAt: null,
      isActive: true,
      branchStatus: 'ACTIVE',
      enabledModules: { has: 'lab_operations' },
    });
  });
});

describe('TechnicianBranchAccessService - sender link', () => {
  it('default scope: the own branch is flagged only when it has sent samples that were accepted', async () => {
    const withLink = build({
      profiles: [],
      activeBranches: [A],
      moduleOn: [A],
      permissions: {},
      sentBy: [A],
    });
    expect(
      (await withLink.svc.resolveScope(TENANT, PERSON, ACTIVE, undefined))
        .rules,
    ).toEqual([{ branchId: A, statuses: 'ALL', senderLinked: true }]);

    const without = build({
      profiles: [],
      activeBranches: [A],
      moduleOn: [A],
      permissions: {},
    });
    expect(
      (await without.svc.resolveScope(TENANT, PERSON, ACTIVE, undefined))
        .rules[0]?.senderLinked,
    ).toBe(false);
  });

  it('All Branches: each branch is flagged on its own sends, never on another branch', async () => {
    const { svc } = build({
      profiles: [{ branchId: B }, { branchId: C }],
      activeBranches: [A, B, C],
      moduleOn: [A, B, C],
      permissions: { [B]: FULL, [C]: FULL },
      sentBy: [B],
    });
    const scope = await svc.resolveScope(TENANT, PERSON, ACTIVE, 'all');
    const linked = Object.fromEntries(
      scope.rules.map((r) => [r.branchId, r.senderLinked]),
    );
    expect(linked).toEqual({ [A]: false, [B]: true, [C]: false });
  });

  it('only authorised branches are asked about (no lookup for others)', async () => {
    const { svc, prisma } = build({
      profiles: [{ branchId: B }],
      activeBranches: [A, B, E],
      moduleOn: [A, B, E],
      permissions: { [B]: FULL },
      sentBy: [E],
    });
    await svc.resolveScope(TENANT, PERSON, ACTIVE, 'all');
    const where = (
      prisma.sampleTransfer.findMany.mock.calls[0] as [
        { where: { branchId: { in: string[] } } },
      ]
    )[0].where;
    expect([...where.branchId.in].sort()).toEqual([A, B]);
  });

  it('special tabs never carry the sender link (they list work the branch can act on)', async () => {
    const { svc, prisma } = build({
      profiles: [{ branchId: B }],
      activeBranches: [A, B],
      moduleOn: [A, B],
      permissions: { [B]: [K.LAB_ACCESS_CRITICAL_LIST] },
      sentBy: [A, B],
    });
    const scope = await svc.resolveScope(
      TENANT,
      PERSON,
      ACTIVE,
      'all',
      K.LAB_ACCESS_CRITICAL_LIST,
    );
    expect(scope.rules.every((r) => !r.senderLinked)).toBe(true);
    expect(prisma.sampleTransfer.findMany).not.toHaveBeenCalled();
  });

  it('the transfer lookup only counts INTERNAL transfers the receiver ACCEPTED', async () => {
    const { svc, prisma } = build({
      profiles: [],
      activeBranches: [A],
      moduleOn: [A],
      permissions: {},
    });
    await svc.resolveScope(TENANT, PERSON, ACTIVE, undefined);
    const where = (
      prisma.sampleTransfer.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ]
    )[0].where;
    expect(where).toMatchObject({
      tenantId: TENANT,
      kind: 'INTERNAL',
      transferStatus: 'ACCEPTED',
      deletedAt: null,
    });
  });

  it('hasSenderLinkTo: true when a branch of the caller sent the report', async () => {
    const { svc, prisma } = build({
      profiles: [],
      activeBranches: [A],
      moduleOn: [A],
      permissions: {},
      linkedReport: true,
    });
    expect(await svc.hasSenderLinkTo(TENANT, PERSON, ACTIVE, 'r1')).toBe(true);
    const where = (
      prisma.labReport.findFirst.mock.calls[0] as [
        { where: Record<string, unknown> },
      ]
    )[0].where;
    expect(where).toMatchObject({
      id: 'r1',
      tenantId: TENANT,
      branchId: { not: A },
    });
  });

  it('hasSenderLinkTo: false when nothing links the report to the caller branches', async () => {
    const { svc } = build({
      profiles: [],
      activeBranches: [A],
      moduleOn: [A],
      permissions: {},
      linkedReport: false,
    });
    expect(await svc.hasSenderLinkTo(TENANT, PERSON, ACTIVE, 'r1')).toBe(false);
  });

  it('hasSenderLinkTo: an authorised branch counts too, limited to the statuses it may see', async () => {
    const { svc, prisma } = build({
      profiles: [{ branchId: B }],
      activeBranches: [A, B],
      moduleOn: [A, B],
      permissions: { [B]: [K.LAB_ACCESS_SAVED] },
      linkedReport: false,
    });
    await svc.hasSenderLinkTo(TENANT, PERSON, ACTIVE, 'r1');
    const calls = prisma.labReport.findFirst.mock.calls as Array<
      [{ where: { branchId: { not: string }; status?: { in: string[] } } }]
    >;
    const forB = calls.find((c) => c[0].where.branchId.not === B)?.[0].where;
    const forA = calls.find((c) => c[0].where.branchId.not === A)?.[0].where;
    expect(forB?.status).toEqual({ in: ['SAVED'] });
    expect(forA?.status).toBeUndefined();
  });
});
