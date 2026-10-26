import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env into process.env before the Prisma client is constructed (mirrors
// the other e2e suites — no dotenv dependency).
try {
  const env = readFileSync(join(process.cwd(), '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const match = /^\s*([\w.]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = (match[2] ?? '').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  /* .env optional — the suite self-skips if the DB is unreachable */
}

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { LabReportStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { HttpExceptionFilter } from './../src/common/filters';
import { ResponseInterceptor } from './../src/common/interceptors';
import { PERMISSION_KEYS } from './../src/modules/permissions/constants/module-permissions.constant';

/**
 * End-to-end proof of the cross-branch Technician worklist.
 *
 * Seeds, in an existing tenant, a throwaway technician and eight throwaway
 * branches that exercise every access situation, plus a few cloned lab reports
 * per branch (Pending / Saved / Approved). Then drives the real HTTP API with a
 * token for that technician and checks the access model end to end:
 *
 *   A  own branch (the active one)                      sees everything
 *   B  branch + module + full permissions               sees + works
 *   C  limited: no Approved/Published/Result-Done access, no enter-result
 *   D  module access, every ACTION permission removed   view / print only
 *   E  branch access but NO Technician module           never shown
 *   F  no profile at all                                never shown
 *   G  profile exists but branch status INACTIVE        never shown
 *   H  module access but NO report permissions          nothing visible
 *
 * Branch access, Technician-module access and report permissions are three
 * separate gates, and a report is always judged by ITS OWN branch's
 * permissions — "All Branches" only widens the set, it never merges permissions.
 *
 * Sent flow (internal transfer): two more throwaway order items stand for a test
 * branch A SENT to branch S (the technician has no profile at S). One was
 * accepted by S (the report now sits at S) and one is still in transit (the
 * report is still at A). The sender must still see both, view-only; every write
 * is refused.
 *
 * All seeded rows are hard-deleted in afterAll. Requires a reachable PostgreSQL
 * with at least one lab report whose order item is a plain (non panel-member)
 * test, and the `lab_technician` role; the suite self-skips otherwise (and says
 * so in the console) so it stays green on an empty database / in CI without one.
 * A seeding failure AFTER the fixtures are found is NOT swallowed — it fails.
 */
describe('Technician cross-branch worklist (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ready = false;

  let tenantId = '';
  let personId = '';
  let token = '';
  let roleId = '';
  let baseReportId = '';

  const BR: Record<string, string> = {};
  /** reportIds[branchLetter][status] */
  const reportIds: Record<
    string,
    Partial<Record<LabReportStatus, string>>
  > = {};
  const created = {
    branches: [] as string[],
    profiles: [] as string[],
    modules: [] as string[],
    perms: [] as string[],
    reports: [] as string[],
    alerts: [] as string[],
    deptAssignments: [] as string[],
    memberships: [] as string[],
    items: [] as string[],
    samples: [] as string[],
    sampleTests: [] as string[],
    transfers: [] as string[],
  };
  let branchS = '';
  let reportAtS = ''; // sent by A, accepted by S: the report now sits at S
  let reportInTransit = ''; // sent by A, not accepted yet: still at A
  let acceptedTransferId = '';

  const K = PERMISSION_KEYS;
  const ALL_LAB_KEYS = Object.entries(K)
    .filter(([k]) => k.startsWith('LAB_'))
    .map(([, v]) => v as string);
  const ACCESS_KEYS = ALL_LAB_KEYS.filter(
    (k) =>
      k.includes('__access_to_') &&
      !k.includes('enter_result') &&
      !k.includes('list') &&
      !k.includes('out_of_reference'),
  );
  const ACTION_KEYS = ALL_LAB_KEYS.filter(
    (k) => !ACCESS_KEYS.includes(k) && !k.includes('list'),
  );

  const STATUSES = [
    LabReportStatus.PENDING,
    LabReportStatus.SAVED,
    LabReportStatus.APPROVED,
  ] as const;
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const mine = (id: string) =>
    Object.values(reportIds).some((m) => Object.values(m).includes(id));
  const idOf = (letter: string, status: LabReportStatus): string =>
    reportIds[letter]?.[status] ?? '';

  /** Rows of a list response, restricted to the reports this suite seeded. */
  async function listIds(query = ''): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/lab-reports?limit=100${query ? `&${query}` : ''}`)
      .set(auth());
    if (res.status !== 200) expect(res.status).toBe(200);
    const rows: Array<{ id: string }> = Array.isArray(res.body?.data)
      ? res.body.data
      : (res.body?.data?.data ?? []);
    return rows
      .map((r) => r.id)
      .filter(mine)
      .sort();
  }

  const idsFor = (...pairs: Array<[string, LabReportStatus]>) =>
    pairs.map(([l, s]) => idOf(l, s)).sort();
  const allOf = (letter: string): Array<[string, LabReportStatus]> =>
    STATUSES.map((s) => [letter, s]);

  const run = (name: string, fn: () => Promise<void>) =>
    it(name, async () => {
      if (!ready) return;
      await fn();
    });

  beforeAll(async () => {
    let moduleRef;
    try {
      moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api/v1', {
        exclude: ['emi/orders', 'emi/submitResult'],
      });
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalInterceptors(new ResponseInterceptor());
      await app.init();
      prisma = app.get(PrismaService);
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      console.warn('[technician-cross-branch e2e] skipped: no DB —', String(e));
      return;
    }

    // --- find the fixtures we depend on; skip (loudly) if absent ------------
    const role = await prisma.authRole.findFirst({
      where: { key: 'lab_technician', deletedAt: null },
      select: { id: true },
    });
    const base = await prisma.labReport.findFirst({
      where: { deletedAt: null, memberBranchLabTestId: null },
      include: {
        orderItem: {
          select: {
            orderId: true,
            branchLabTest: { select: { departmentId: true } },
            branchLabPanel: { select: { departmentId: true } },
          },
        },
      },
    });
    const branch = base
      ? await prisma.branch.findFirst({
          where: { tenantId: base.tenantId, deletedAt: null },
        })
      : null;
    if (!role || !base || !branch) {
      console.warn(
        '[technician-cross-branch e2e] skipped: needs the lab_technician role and one lab report',
      );
      return;
    }
    tenantId = base.tenantId;
    roleId = role.id;
    baseReportId = base.id;
    const stamp = Date.now().toString(36);

    // --- branches ------------------------------------------------------------
    for (const l of LETTERS) {
      const b = await prisma.branch.create({
        data: {
          tenantId,
          name: `E2E XB ${l} ${stamp}`,
          shortName: `XB${l}`.slice(0, 8),
          code: `XB${l}${stamp}`.toUpperCase().slice(0, 20),
          branchType: branch.branchType,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      BR[l] = b.id;
      created.branches.push(b.id);
      // the Technician module is switched on at every branch (E is excluded by
      // its profile, not by the branch)
      const m = await prisma.branchModule.create({
        data: {
          tenantId,
          branchId: b.id,
          moduleKey: 'lab_operations',
          isEnabled: true,
        },
        select: { id: true },
      });
      created.modules.push(m.id);
    }

    // --- the technician --------------------------------------------------------
    const person = await prisma.person.create({
      data: {
        platformMrn: `E2EXB${stamp}`.toUpperCase(),
        firstName: 'E2E',
        lastName: `Tech ${stamp}`,
        isStaff: true,
        ownerTenantId: tenantId,
      },
      select: { id: true },
    });
    personId = person.id;
    const membership = await prisma.tenantStaffMembership.create({
      data: {
        tenantId,
        personId,
        userCode: `E2E-XB-${stamp}`.toUpperCase(),
        authRoleId: roleId,
      },
      select: { id: true },
    });
    created.memberships.push(membership.id);

    const withModule = ['accession', 'lab_operations'];
    const withoutModule = ['accession'];
    const profile = async (
      letter: string,
      over: {
        enabledModules?: string[];
        branchStatus?: 'ACTIVE' | 'INACTIVE';
      } = {},
    ) => {
      const p = await prisma.userBranchProfile.create({
        data: {
          tenantId,
          personId,
          branchId: BR[letter],
          authRoleId: roleId,
          enabledModules: over.enabledModules ?? withModule,
          branchStatus: over.branchStatus ?? 'ACTIVE',
          isDefault: letter === 'A',
          isActive: true,
        },
        select: { id: true },
      });
      created.profiles.push(p.id);
    };
    await profile('A');
    await profile('B');
    await profile('C');
    await profile('D');
    await profile('E', { enabledModules: withoutModule });
    await profile('G', { branchStatus: 'INACTIVE' });
    await profile('H');
    // F: deliberately no profile

    const deny = async (letter: string, keys: string[]) => {
      for (const permissionKey of keys) {
        const r = await prisma.userBranchPermission.create({
          data: {
            tenantId,
            personId,
            branchId: BR[letter] as string,
            moduleKey: 'lab_operations',
            permissionKey,
            allowed: false,
          },
          select: { id: true },
        });
        created.perms.push(r.id);
      }
    };
    await deny('C', [
      K.LAB_ACCESS_APPROVED,
      K.LAB_ACCESS_PUBLISHED,
      K.LAB_ACCESS_RESULT_DONE,
      K.LAB_ENTER_RESULT,
      K.LAB_EDIT_REPORT,
    ]);
    await deny('D', ACTION_KEYS);
    await deny('H', ALL_LAB_KEYS);

    // Department scope is per person: allow the department of the cloned test.
    const dept =
      base.orderItem.branchLabTest?.departmentId ??
      base.orderItem.branchLabPanel?.departmentId ??
      null;
    if (dept) {
      const d = await prisma.userDepartmentAssignment.create({
        data: { tenantId, personId, departmentId: dept },
        select: { id: true },
      });
      created.deptAssignments.push(d.id);
    }

    // --- reports: one per (branch, status), cloned from a real report -------------
    const {
      id: _id,
      createdAt: _c,
      updatedAt: _u,
      orderItem: _oi,
      ...clone
    } = base;
    for (const l of LETTERS) {
      reportIds[l] = {};
      for (const status of STATUSES) {
        const r = await prisma.labReport.create({
          data: {
            ...(clone as object),
            branchId: BR[l],
            status,
            deletedAt: null,
          } as never,
          select: { id: true },
        });
        reportIds[l][status] = r.id;
        created.reports.push(r.id);
      }
    }

    // Critical alerts on B's Saved (visible) and C's Approved (hidden at C).
    for (const [l, s] of [
      ['A', LabReportStatus.SAVED],
      ['B', LabReportStatus.SAVED],
      ['C', LabReportStatus.SAVED],
      ['C', LabReportStatus.APPROVED],
    ] as const) {
      const a = await prisma.criticalAlert.create({
        data: {
          tenantId,
          branchId: BR[l],
          labReportId: idOf(l, s),
          reportStatusAtTrigger: s,
        },
        select: { id: true },
      });
      created.alerts.push(a.id);
    }

    // --- sent flow: branch S (no profile for the technician) + two sent tests ----------
    const bS = await prisma.branch.create({
      data: {
        tenantId,
        name: `E2E XB S ${stamp}`,
        shortName: 'XBS',
        code: `XBS${stamp}`.toUpperCase().slice(0, 20),
        branchType: branch.branchType,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    branchS = bS.id;
    created.branches.push(bS.id);
    const mS = await prisma.branchModule.create({
      data: {
        tenantId,
        branchId: bS.id,
        moduleKey: 'lab_operations',
        isEnabled: true,
      },
      select: { id: true },
    });
    created.modules.push(mS.id);

    const baseItem = await prisma.orderItem.findUniqueOrThrow({
      where: { id: base.orderItemId },
    });
    const { id: _bid, createdAt: _bc, updatedAt: _bu, ...itemData } = baseItem;
    const makeSentTest = async (opts: {
      reportBranch: string;
      reportStatus: LabReportStatus;
      transferStatus: 'ACCEPTED' | 'IN_TRANSIT';
      tag: string;
    }) => {
      const item = await prisma.orderItem.create({
        data: itemData as never,
        select: { id: true },
      });
      created.items.push(item.id);
      const report = await prisma.labReport.create({
        data: {
          ...(clone as object),
          orderItemId: item.id,
          branchId: opts.reportBranch,
          status: opts.reportStatus,
          deletedAt: null,
        } as never,
        select: { id: true },
      });
      created.reports.push(report.id);
      const sample = await prisma.orderSample.create({
        data: {
          tenantId,
          orderId: base.orderItem.orderId,
          labTestSampleId: 'e2e-lts',
          accessionNo: `E2E-${opts.tag}-${stamp}`.toUpperCase(),
          branchId: BR.A,
          status: 'SENT_INTERNAL',
        } as never,
        select: { id: true },
      });
      created.samples.push(sample.id);
      const link = await prisma.orderSampleTest.create({
        data: {
          tenantId,
          sampleId: sample.id,
          orderItemId: item.id,
          labTestId: base.labTestId,
        },
        select: { id: true },
      });
      created.sampleTests.push(link.id);
      const transfer = await prisma.sampleTransfer.create({
        data: {
          tenantId,
          sampleId: sample.id,
          kind: 'INTERNAL',
          transferStatus: opts.transferStatus,
          branchId: BR.A,
          destinationBranchId: bS.id,
        } as never,
        select: { id: true },
      });
      created.transfers.push(transfer.id);
      return { reportId: report.id, transferId: transfer.id };
    };
    const accepted = await makeSentTest({
      reportBranch: bS.id,
      reportStatus: LabReportStatus.SAVED,
      transferStatus: 'ACCEPTED',
      tag: 'ACC',
    });
    reportAtS = accepted.reportId;
    acceptedTransferId = accepted.transferId;
    const transit = await makeSentTest({
      reportBranch: BR.A ?? '',
      reportStatus: LabReportStatus.PENDING,
      transferStatus: 'IN_TRANSIT',
      tag: 'TRN',
    });
    reportInTransit = transit.reportId;

    // --- token for the technician, active at A ---------------------------------------
    token = app.get(JwtService, { strict: false }).sign(
      {
        person_id: personId,
        tenant_id: tenantId,
        active_branch_id: BR.A,
        active_branch_type: branch.branchType,
        active_profile_key: 'lab_technician',
        is_patient_context: false,
        profiles: [],
        is_patient: false,
        platform_mrn: null,
        referral_panel_id: null,
      },
      { expiresIn: '15m' },
    );
    ready = true;
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.criticalAlert.deleteMany({
          where: { id: { in: created.alerts } },
        });
        await prisma.sampleTransfer.deleteMany({
          where: { id: { in: created.transfers } },
        });
        await prisma.orderSampleTest.deleteMany({
          where: { id: { in: created.sampleTests } },
        });
        await prisma.orderSample.deleteMany({
          where: { id: { in: created.samples } },
        });
        await prisma.labReport.deleteMany({
          where: { id: { in: created.reports } },
        });
        await prisma.orderItem.deleteMany({
          where: { id: { in: created.items } },
        });
        await prisma.userBranchPermission.deleteMany({
          where: { id: { in: created.perms } },
        });
        await prisma.userBranchProfile.deleteMany({
          where: { id: { in: created.profiles } },
        });
        await prisma.userDepartmentAssignment.deleteMany({
          where: { id: { in: created.deptAssignments } },
        });
        await prisma.branchModule.deleteMany({
          where: { id: { in: created.modules } },
        });
        await prisma.tenantStaffMembership.deleteMany({
          where: { id: { in: created.memberships } },
        });
        if (personId)
          await prisma.person.deleteMany({ where: { id: personId } });
        await prisma.branch.deleteMany({
          where: { id: { in: created.branches } },
        });
      }
    } finally {
      if (app) await app.close();
    }
  }, 120_000);

  // ---------------------------------------------------------------------------
  describe('which branches are shown (branch access + Technician module)', () => {
    run(
      '(8) by default only the own branch is shown — behaviour unchanged',
      async () => {
        expect(await listIds()).toEqual(idsFor(...allOf('A')));
      },
    );

    run(
      '(4,6,12) All Branches = authorised branches only, never E / F / G',
      async () => {
        const got = await listIds('branchId=all');
        for (const hidden of ['E', 'F', 'G']) {
          for (const s of STATUSES) expect(got).not.toContain(idOf(hidden, s));
        }
        // A, B, D in full; C without Approved; H nothing
        expect(got).toEqual(
          idsFor(
            ...allOf('A'),
            ...allOf('B'),
            ['C', LabReportStatus.PENDING],
            ['C', LabReportStatus.SAVED],
            ...allOf('D'),
          ),
        );
      },
    );

    run('(5) a specific branch shows only that branch', async () => {
      expect(await listIds(`branchId=${BR.B}`)).toEqual(idsFor(...allOf('B')));
      expect(await listIds(`branchId=${BR.D}`)).toEqual(idsFor(...allOf('D')));
    });

    for (const [letter, why] of [
      ['E', 'branch access but no Technician module'],
      ['F', 'no access at all'],
      ['G', 'access removed (branch status inactive)'],
    ] as const) {
      run(
        `(6,10) asking for branch ${letter} (${why}) is refused, not silently shown`,
        async () => {
          const res = await request(app.getHttpServer())
            .get(`/api/v1/lab-reports?branchId=${BR[letter]}`)
            .set(auth());
          expect(res.status).toBe(403);
          expect(JSON.stringify(res.body)).toContain('BRANCH_NOT_ACCESSIBLE');
        },
      );
    }

    run(
      'rejects a malformed branchId (400) and an unknown branch (403) rather than ignoring it',
      async () => {
        const bad = await request(app.getHttpServer())
          .get('/api/v1/lab-reports?branchId=everything')
          .set(auth());
        expect(bad.status).toBe(400);
        const unknown = await request(app.getHttpServer())
          .get(
            '/api/v1/lab-reports?branchId=00000000-0000-4000-8000-000000000000',
          )
          .set(auth());
        expect(unknown.status).toBe(403);
      },
    );
  });

  // ---------------------------------------------------------------------------
  describe('report permissions decide WHAT is visible, per branch', () => {
    run(
      '(2,9) C hides the stages it denies — Approved is absent even under All Branches',
      async () => {
        expect(await listIds(`branchId=${BR.C}`)).toEqual(
          idsFor(['C', LabReportStatus.PENDING], ['C', LabReportStatus.SAVED]),
        );
        // …while B (same technician, same request) still shows its Approved report
        expect(await listIds('branchId=all')).toContain(
          idOf('B', LabReportStatus.APPROVED),
        );
        expect(await listIds('branchId=all')).not.toContain(
          idOf('C', LabReportStatus.APPROVED),
        );
      },
    );

    run(
      '(7) module access with no report permissions reaches the branch but shows nothing',
      async () => {
        expect(await listIds(`branchId=${BR.H}`)).toEqual([]);
      },
    );

    run(
      'the status tab filter composes with the branch rules (Approved only)',
      async () => {
        expect(await listIds('branchId=all&status=APPROVED')).toEqual(
          idsFor(
            ['A', LabReportStatus.APPROVED],
            ['B', LabReportStatus.APPROVED],
            ['D', LabReportStatus.APPROVED],
          ),
        );
      },
    );

    run('counts follow the same per-branch rule as the list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/lab-reports/counts?branchId=all')
        .set(auth());
      expect(res.status).toBe(200);
      const c = res.body.data;
      // A(1 each) + B(1 each) + C(P,S) + D(1 each) = 3 Pending, 3 Saved, 3 Approved? no:
      // Pending A,B,C,D = 4 (+1 sent test still in transit, at A);
      // Saved A,B,C,D = 4 (+1 sent test accepted by S, seen through the sender
      // link); Approved A,B,D = 3
      expect(c.pending).toBe(5);
      expect(c.saved).toBe(5);
      expect(c.approved).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  describe('branch-access (feeds the dropdown + per-row gating)', () => {
    run(
      '(4,6,12) lists exactly the authorised branches, own first',
      async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/lab-reports/branch-access')
          .set(auth());
        expect(res.status).toBe(200);
        const rows: Array<{
          branchId: string;
          isActiveBranch: boolean;
          permissions: string[];
          visibleStatuses: string[] | 'ALL';
        }> = res.body.data;
        const ids = rows.map((r) => r.branchId);
        expect(ids[0]).toBe(BR.A);
        expect(ids.slice().sort()).toEqual(
          [BR.A, BR.B, BR.C, BR.D, BR.H].sort(),
        );
        for (const hidden of ['E', 'F', 'G'])
          expect(ids).not.toContain(BR[hidden]);

        // permissions are per branch, never merged
        const at = (l: string) => rows.find((r) => r.branchId === BR[l])!;
        expect(at('B').permissions).toContain(K.LAB_ENTER_RESULT);
        expect(at('C').permissions).not.toContain(K.LAB_ENTER_RESULT);
        expect(at('C').permissions).not.toContain(K.LAB_ACCESS_APPROVED);
        expect(at('B').permissions).toContain(K.LAB_ACCESS_APPROVED);
        expect(at('D').permissions).not.toContain(K.LAB_MARK_RE_RUN);
        // H: no report permission of any kind (reporting stages or actions)
        expect(
          at('H').permissions.filter((p) => ALL_LAB_KEYS.includes(p)),
        ).toEqual([]);
        expect(at('H').visibleStatuses).toEqual([]);
        expect(at('A').visibleStatuses).toBe('ALL');
      },
    );
  });

  // ---------------------------------------------------------------------------
  describe('acting on one report is judged at THAT report’s branch', () => {
    run(
      '(1) a report at B opens (the guard re-points the request at B)',
      async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/lab-reports/${idOf('B', LabReportStatus.SAVED)}`)
          .set(auth());
        expect(res.status).toBe(200);
      },
    );

    run(
      '(1,9) an action B grants works there; the same action D does not grant is 403',
      async () => {
        const atB = await request(app.getHttpServer())
          .get(`/api/v1/lab-reports/${idOf('B', LabReportStatus.SAVED)}/trend`)
          .set(auth());
        expect([403, 404]).not.toContain(atB.status);
        const atD = await request(app.getHttpServer())
          .get(`/api/v1/lab-reports/${idOf('D', LabReportStatus.SAVED)}/trend`)
          .set(auth());
        expect(atD.status).toBe(403);
      },
    );

    run(
      '(2) limited branch C: entering results is 403 even though the same technician may at A',
      async () => {
        const atC = await request(app.getHttpServer())
          .post(
            `/api/v1/lab-reports/${idOf('C', LabReportStatus.PENDING)}/save`,
          )
          .set(auth())
          .send({});
        expect(atC.status).toBe(403);
      },
    );

    run(
      '(3) view-only branch D: marking a re-run is 403, viewing is allowed',
      async () => {
        const act = await request(app.getHttpServer())
          .post(
            `/api/v1/lab-reports/${idOf('D', LabReportStatus.SAVED)}/re-run`,
          )
          .set(auth())
          .send({});
        expect(act.status).toBe(403);
        const view = await request(app.getHttpServer())
          .get(`/api/v1/lab-reports/${idOf('D', LabReportStatus.SAVED)}`)
          .set(auth());
        expect(view.status).toBe(200);
      },
    );

    run(
      'a stage hidden at its branch cannot be opened by id either (404, not a leak)',
      async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/lab-reports/${idOf('C', LabReportStatus.APPROVED)}`)
          .set(auth());
        expect(res.status).toBe(404);
      },
    );

    for (const letter of ['E', 'F', 'G', 'H'] as const) {
      run(`(6,7,10) a report at ${letter} cannot be opened by id`, async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/lab-reports/${idOf(letter, LabReportStatus.SAVED)}`)
          .set(auth());
        expect(res.status).toBe(404);
      });
    }
  });

  // ---------------------------------------------------------------------------
  describe('special tabs follow the same branch filter', () => {
    async function alertReportIds(query: string): Promise<string[]> {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/critical-alerts${query}`)
        .set(auth());
      expect(res.status).toBe(200);
      const rows: Array<{ labReportId: string }> = Array.isArray(res.body?.data)
        ? res.body.data
        : (res.body?.data?.data ?? []);
      return rows
        .map((r) => r.labReportId)
        .filter(mine)
        .sort();
    }

    run('default: own branch only', async () => {
      expect(await alertReportIds('')).toEqual(
        idsFor(['A', LabReportStatus.SAVED]),
      );
    });

    run(
      'All Branches: B’s alert shows, C’s Approved one stays hidden (C denies Approved)',
      async () => {
        expect(await alertReportIds('?branchId=all')).toEqual(
          idsFor(
            ['A', LabReportStatus.SAVED],
            ['B', LabReportStatus.SAVED],
            ['C', LabReportStatus.SAVED],
          ),
        );
      },
    );

    run('a branch that is not authorised is refused', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/critical-alerts?branchId=${BR.E}`)
        .set(auth());
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  describe('revocation takes effect on the very next request (10, 11)', () => {
    run(
      '(10) removing branch access removes the branch from All Branches and from the dropdown',
      async () => {
        const profileRow = await prisma.userBranchProfile.findFirst({
          where: { personId, branchId: BR.B, deletedAt: null },
        });
        await prisma.userBranchProfile.update({
          where: { id: profileRow!.id },
          data: { branchStatus: 'INACTIVE' },
        });
        try {
          expect(await listIds('branchId=all')).not.toContain(
            idOf('B', LabReportStatus.SAVED),
          );
          const res = await request(app.getHttpServer())
            .get(`/api/v1/lab-reports?branchId=${BR.B}`)
            .set(auth());
          expect(res.status).toBe(403);
          const open = await request(app.getHttpServer())
            .get(`/api/v1/lab-reports/${idOf('B', LabReportStatus.SAVED)}`)
            .set(auth());
          expect(open.status).toBe(404);
        } finally {
          await prisma.userBranchProfile.update({
            where: { id: profileRow!.id },
            data: { branchStatus: 'ACTIVE' },
          });
        }
        expect(await listIds('branchId=all')).toContain(
          idOf('B', LabReportStatus.SAVED),
        );
      },
    );

    run(
      '(11) removing Technician-module access removes the branch',
      async () => {
        const profileRow = await prisma.userBranchProfile.findFirst({
          where: { personId, branchId: BR.D, deletedAt: null },
        });
        await prisma.userBranchProfile.update({
          where: { id: profileRow!.id },
          data: { enabledModules: ['accession'] },
        });
        try {
          expect(await listIds('branchId=all')).not.toContain(
            idOf('D', LabReportStatus.SAVED),
          );
          const res = await request(app.getHttpServer())
            .get(`/api/v1/lab-reports?branchId=${BR.D}`)
            .set(auth());
          expect(res.status).toBe(403);
        } finally {
          await prisma.userBranchProfile.update({
            where: { id: profileRow!.id },
            data: { enabledModules: ['accession', 'lab_operations'] },
          });
        }
      },
    );

    run(
      '(11) switching the module off for the branch itself also removes it',
      async () => {
        const row = await prisma.branchModule.findFirst({
          where: { branchId: BR.C, moduleKey: 'lab_operations' },
        });
        await prisma.branchModule.update({
          where: { id: row!.id },
          data: { isEnabled: false },
        });
        try {
          expect(await listIds('branchId=all')).not.toContain(
            idOf('C', LabReportStatus.SAVED),
          );
        } finally {
          await prisma.branchModule.update({
            where: { id: row!.id },
            data: { isEnabled: true },
          });
        }
      },
    );
  });

  // ---------------------------------------------------------------------------
  describe('sent flow: the sender keeps seeing what it sent, view-only', () => {
    async function listRows(query = '') {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/lab-reports?limit=100${query ? `&${query}` : ''}`)
        .set(auth());
      expect(res.status).toBe(200);
      const rows: Array<{ id: string; accessMode?: string }> = Array.isArray(
        res.body?.data,
      )
        ? res.body.data
        : (res.body?.data?.data ?? []);
      return rows;
    }
    const idsIn = async (query = '') =>
      (await listRows(query)).map((r) => r.id);

    run(
      'the report held by the receiving branch is still listed for the sender (default view)',
      async () => {
        expect(await idsIn()).toContain(reportAtS);
      },
    );

    run('the report still waiting at the sender is listed too', async () => {
      expect(await idsIn()).toContain(reportInTransit);
    });

    run(
      'both sent rows are marked view-only, normal rows are full',
      async () => {
        const rows = await listRows();
        const mode = (id: string) => rows.find((r) => r.id === id)?.accessMode;
        expect(mode(reportAtS)).toBe('view'); // held elsewhere, listed by the link
        expect(mode(reportInTransit)).toBe('view'); // locked while in transit
        expect(mode(idOf('A', LabReportStatus.SAVED))).toBe('full');
      },
    );

    run(
      'All Branches includes it; another authorised branch (which sent nothing) does not',
      async () => {
        expect(await idsIn('branchId=all')).toContain(reportAtS);
        expect(await idsIn(`branchId=${BR.B}`)).not.toContain(reportAtS);
      },
    );

    run('the sender can open and read it', async () => {
      for (const path of ['', '/history']) {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/lab-reports/${reportAtS}${path}`)
          .set(auth());
        expect(res.status).toBe(200);
      }
    });

    run(
      'but cannot change it: every write on the report held by S is refused',
      async () => {
        const save = await request(app.getHttpServer())
          .post(`/api/v1/lab-reports/${reportAtS}/save`)
          .set(auth())
          .send({});
        expect(save.status).toBe(404);
        const results = await request(app.getHttpServer())
          .patch(`/api/v1/lab-reports/${reportAtS}/results`)
          .set(auth())
          .send({
            values: [
              {
                resultParamId: '00000000-0000-4000-8000-000000000000',
                observed1: '1',
              },
            ],
          });
        expect(results.status).toBe(404);
        const adjust = await request(app.getHttpServer())
          .delete(
            `/api/v1/lab-reports/${reportAtS}/tat-adjustments/00000000-0000-4000-8000-000000000000`,
          )
          .set(auth());
        expect(adjust.status).toBe(404);
      },
    );

    run(
      'an alert raised at the sender for a report that has since moved cannot be updated either',
      async () => {
        const alert = await prisma.criticalAlert.create({
          data: {
            tenantId,
            branchId: BR.A,
            labReportId: reportAtS,
            reportStatusAtTrigger: LabReportStatus.SAVED,
          },
          select: { id: true },
        });
        created.alerts.push(alert.id);
        const res = await request(app.getHttpServer())
          .patch(`/api/v1/critical-alerts/${alert.id}/status`)
          .set(auth())
          .send({ status: 'ACKNOWLEDGED' });
        expect(res.status).toBe(404);
      },
    );

    run(
      'before Accept the report is still at the sender: readable, but every write says "sent out"',
      async () => {
        const read = await request(app.getHttpServer())
          .get(`/api/v1/lab-reports/${reportInTransit}`)
          .set(auth());
        expect(read.status).toBe(200);
        const save = await request(app.getHttpServer())
          .post(`/api/v1/lab-reports/${reportInTransit}/save`)
          .set(auth())
          .send({});
        expect(save.status).toBe(409);
        expect(JSON.stringify(save.body)).toContain('LAB_REPORT_SENT_OUT');
      },
    );

    run(
      'the link ends when the transfer is undone (receiver repeats or returns)',
      async () => {
        await prisma.sampleTransfer.update({
          where: { id: acceptedTransferId },
          data: { transferStatus: 'REPEAT' },
        });
        try {
          expect(await idsIn()).not.toContain(reportAtS);
          const res = await request(app.getHttpServer())
            .get(`/api/v1/lab-reports/${reportAtS}`)
            .set(auth());
          expect(res.status).toBe(404);
        } finally {
          await prisma.sampleTransfer.update({
            where: { id: acceptedTransferId },
            data: { transferStatus: 'ACCEPTED' },
          });
        }
        expect(await idsIn()).toContain(reportAtS);
      },
    );

    run(
      'a branch that never sent it gets nothing: the TAT summary refuses an unauthorised branch',
      async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/lab-reports/tat/summary?branchId=${BR.E}`)
          .set(auth());
        expect(res.status).toBe(403);
      },
    );
  });

  it('keeps the fixtures it needs (sanity)', () => {
    if (!ready) return;
    expect(baseReportId).toBeTruthy();
    expect(Object.keys(BR)).toHaveLength(LETTERS.length);
    expect(branchS).toBeTruthy();
  });
});
