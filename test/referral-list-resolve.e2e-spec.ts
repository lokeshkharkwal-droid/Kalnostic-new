import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env into process.env before the Prisma client is constructed (mirrors
// b2b-referral-panel.e2e-spec.ts — no dotenv dependency).
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

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { ReferralListAssignmentService } from './../src/modules/referral-list/referral-list-assignment.service';

/**
 * Integration test of the price-list lookup (`ReferralListAssignmentService.resolve`,
 * behind `GET /referral-lists/resolve`) against the REAL database: the service,
 * PtCategoryService and Prisma together, with real rows.
 *
 * Priority, first one with a list wins: Referral Panel -> Patient (PT) Category ->
 * Referred-by doctor -> Internal -> External -> the branch's default Walk-in lists.
 * Create Order and the Quotation form both depend on it.
 *
 * Seeds throw-away lists, categories and assignments on an existing branch that has
 * default Walk-in lists, and removes them again. The whole suite self-skips when the
 * DB is unreachable or no such branch exists, so it stays green in CI without a DB.
 */
describe('Referral price-list resolve (integration, real DB)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: ReferralListAssignmentService;
  let ready = false;

  let tenantId = '';
  let branchId = '';
  let walkTest = '';
  let walkPanel: string | null = null;

  const tag = `e2e-${Date.now()}`;
  const ids = {
    panelList: '',
    catList: '',
    docList: '',
    intList: '',
    extList: '',
    catMapped: '',
    catPlain: '',
    catInactive: '',
    panelPanelList: '',
    catPanelList: '',
  };
  const ref = {
    panel: randomUUID(),
    doctor: randomUUID(),
    internal: randomUUID(),
    external: randomUUID(),
    halfSetPanel: randomUUID(),
    bothListsPanel: randomUUID(),
  };
  const assignmentIds: string[] = [];

  const resolve = (q: Record<string, string>) =>
    service.resolve(tenantId, branchId, q);

  async function assign(
    type: 'PANEL' | 'DOCTOR' | 'INTERNAL' | 'EXTERNAL',
    referralId: string,
    testListId: string | null,
  ) {
    const row = await prisma.referralListAssignment.create({
      data: {
        tenantId,
        branchId,
        referralType: type,
        referralId,
        branchLabTestListId: testListId,
      },
      select: { id: true },
    });
    assignmentIds.push(row.id);
    return row.id;
  }

  async function makePanelList(name: string) {
    const list = await prisma.branchLabPanelList.create({
      data: {
        tenantId,
        branchId,
        name: `${tag} ${name}`,
        isDefault: false,
        priceType: 'CUSTOMIZED',
      },
      select: { id: true },
    });
    return list.id;
  }

  async function makeList(name: string) {
    const list = await prisma.branchLabTestList.create({
      data: {
        tenantId,
        branchId,
        name: `${tag} ${name}`,
        isDefault: false,
        priceType: 'CUSTOMIZED',
      },
      select: { id: true },
    });
    return list.id;
  }

  beforeAll(async () => {
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      prisma = app.get(PrismaService);
      service = app.get(ReferralListAssignmentService, { strict: false });

      // A branch that already has its default (Walk-in) Lab Test List.
      const walk = await prisma.branchLabTestList.findFirst({
        where: { isDefault: true, deletedAt: null },
        select: { id: true, tenantId: true, branchId: true },
      });
      if (!walk) return; // no fixtures → skip
      tenantId = walk.tenantId;
      branchId = walk.branchId;
      walkTest = walk.id;
      const panel = await prisma.branchLabPanelList.findFirst({
        where: { tenantId, branchId, isDefault: true, deletedAt: null },
        select: { id: true },
      });
      walkPanel = panel?.id ?? null;

      ids.panelList = await makeList('panel');
      ids.catList = await makeList('category');
      ids.docList = await makeList('doctor');
      ids.intList = await makeList('internal');
      ids.extList = await makeList('external');
      ids.panelPanelList = await makePanelList('panel (panels)');
      ids.catPanelList = await makePanelList('category (panels)');

      const cat = (name: string, list: string | null, isActive: boolean) =>
        prisma.ptCategory
          .create({
            data: {
              tenantId,
              branchId,
              categoryName: `${tag} ${name}`,
              branchLabTestListId: list,
              isActive,
              isDefault: false,
            },
            select: { id: true },
          })
          .then((c) => c.id);
      ids.catMapped = await cat('mapped', ids.catList, true);
      ids.catPlain = await cat('plain (like General)', null, true);
      ids.catInactive = await cat('inactive', ids.catList, false);

      await assign('PANEL', ref.panel, ids.panelList);
      await assign('DOCTOR', ref.doctor, ids.docList);
      await assign('INTERNAL', ref.internal, ids.intList);
      await assign('EXTERNAL', ref.external, ids.extList);
      ready = true;
    } catch {
      ready = false; // DB unreachable / seeding failed → self-skip
    }
  }, 60000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.referralListAssignment.deleteMany({
          where: { id: { in: assignmentIds } },
        });
        await prisma.ptCategory.deleteMany({
          where: {
            id: { in: [ids.catMapped, ids.catPlain, ids.catInactive] },
          },
        });
        await prisma.ptCategory.deleteMany({
          where: { categoryName: { startsWith: `${tag} ` } },
        });
        await prisma.branchLabPanelList.deleteMany({
          where: {
            id: {
              in: [ids.panelPanelList, ids.catPanelList].filter(Boolean),
            },
          },
        });
        await prisma.branchLabTestList.deleteMany({
          where: {
            id: {
              in: [
                ids.panelList,
                ids.catList,
                ids.docList,
                ids.intList,
                ids.extList,
              ].filter(Boolean),
            },
          },
        });
      }
    } finally {
      if (app) await app.close();
    }
  }, 60000);

  it('runs against a real database (set REQUIRE_DB=1 to make a skip a failure)', () => {
    if (process.env.REQUIRE_DB === '1') expect(ready).toBe(true);
    else if (!ready)
      console.warn('referral-list-resolve e2e SKIPPED: no database/fixtures');
  });

  it('nothing selected -> the branch Walk-in lists', async () => {
    if (!ready) return;
    await expect(resolve({})).resolves.toEqual({
      branchLabTestListId: walkTest,
      branchLabPanelListId: walkPanel,
      source: 'DEFAULT',
    });
  });

  it('the Referral Panel wins over a category, a doctor, internal and external', async () => {
    if (!ready) return;
    await expect(
      resolve({
        referralPanelId: ref.panel,
        ptCategoryId: ids.catMapped,
        referredByDoctorId: ref.doctor,
        internalReferralId: ref.internal,
        externalReferralId: ref.external,
      }),
    ).resolves.toMatchObject({
      source: 'PANEL',
      branchLabTestListId: ids.panelList,
    });
  });

  it('without a panel the Patient Category wins over the doctor, internal and external', async () => {
    if (!ready) return;
    await expect(
      resolve({
        ptCategoryId: ids.catMapped,
        referredByDoctorId: ref.doctor,
        internalReferralId: ref.internal,
        externalReferralId: ref.external,
      }),
    ).resolves.toMatchObject({
      source: 'PT_CATEGORY',
      branchLabTestListId: ids.catList,
    });
  });

  it('a category with no list (like the default General) is skipped, so the doctor decides', async () => {
    if (!ready) return;
    await expect(
      resolve({ ptCategoryId: ids.catPlain, referredByDoctorId: ref.doctor }),
    ).resolves.toMatchObject({
      source: 'DOCTOR',
      branchLabTestListId: ids.docList,
    });
  });

  it('a category with no list alone resolves to Walk-in', async () => {
    if (!ready) return;
    await expect(
      resolve({ ptCategoryId: ids.catPlain }),
    ).resolves.toMatchObject({
      source: 'DEFAULT',
      branchLabTestListId: walkTest,
    });
  });

  it('an inactive category is skipped even though it has a list', async () => {
    if (!ready) return;
    await expect(
      resolve({
        ptCategoryId: ids.catInactive,
        referredByDoctorId: ref.doctor,
      }),
    ).resolves.toMatchObject({ source: 'DOCTOR' });
  });

  it('doctor beats internal, and internal beats external', async () => {
    if (!ready) return;
    await expect(
      resolve({
        referredByDoctorId: ref.doctor,
        internalReferralId: ref.internal,
        externalReferralId: ref.external,
      }),
    ).resolves.toMatchObject({
      source: 'DOCTOR',
      branchLabTestListId: ids.docList,
    });
    await expect(
      resolve({
        internalReferralId: ref.internal,
        externalReferralId: ref.external,
      }),
    ).resolves.toMatchObject({
      source: 'INTERNAL',
      branchLabTestListId: ids.intList,
    });
    await expect(
      resolve({ externalReferralId: ref.external }),
    ).resolves.toMatchObject({
      source: 'EXTERNAL',
      branchLabTestListId: ids.extList,
    });
  });

  it('a referral that has no assignment falls through to the next choice', async () => {
    if (!ready) return;
    await expect(
      resolve({
        referralPanelId: randomUUID(), // a panel nobody assigned a list to
        referredByDoctorId: randomUUID(), // same for the doctor
        internalReferralId: ref.internal,
      }),
    ).resolves.toMatchObject({ source: 'INTERNAL' });
  });

  it('a panel with only a test list takes the Walk-in panel list', async () => {
    if (!ready) return;
    await assign('PANEL', ref.halfSetPanel, ids.panelList);
    await expect(
      resolve({ referralPanelId: ref.halfSetPanel }),
    ).resolves.toEqual({
      branchLabTestListId: ids.panelList,
      branchLabPanelListId: walkPanel,
      source: 'PANEL',
    });
  });

  it('Lab Panels: a panel assigned both lists resolves its OWN panel list, not Walk-in', async () => {
    if (!ready) return;
    await prisma.referralListAssignment
      .create({
        data: {
          tenantId,
          branchId,
          referralType: 'PANEL',
          referralId: ref.bothListsPanel,
          branchLabTestListId: ids.panelList,
          branchLabPanelListId: ids.panelPanelList,
        },
        select: { id: true },
      })
      .then((r) => assignmentIds.push(r.id));
    await expect(
      resolve({ referralPanelId: ref.bothListsPanel }),
    ).resolves.toEqual({
      branchLabTestListId: ids.panelList,
      branchLabPanelListId: ids.panelPanelList,
      source: 'PANEL',
    });
  });

  it('Lab Panels: a Patient Category mapped to a panel list resolves that panel list', async () => {
    if (!ready) return;
    const cat = await prisma.ptCategory.create({
      data: {
        tenantId,
        branchId,
        categoryName: `${tag} panels-only category`,
        branchLabPanelListId: ids.catPanelList,
        isActive: true,
        isDefault: false,
      },
      select: { id: true },
    });
    await expect(resolve({ ptCategoryId: cat.id })).resolves.toEqual({
      branchLabTestListId: walkTest, // only the panel side is mapped
      branchLabPanelListId: ids.catPanelList,
      source: 'PT_CATEGORY',
    });
  });

  it('a removed (soft-deleted) assignment no longer counts', async () => {
    if (!ready) return;
    const gone = randomUUID();
    const id = await assign('DOCTOR', gone, ids.docList);
    await prisma.referralListAssignment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await expect(
      resolve({ referredByDoctorId: gone, externalReferralId: ref.external }),
    ).resolves.toMatchObject({ source: 'EXTERNAL' });
  });

  it("another branch's assignment for the same referral is ignored", async () => {
    if (!ready) return;
    const other = await prisma.branch.findFirst({
      where: { tenantId, id: { not: branchId }, deletedAt: null },
      select: { id: true },
    });
    if (!other) return; // single-branch fixture → nothing to compare against
    const shared = randomUUID();
    const row = await prisma.referralListAssignment.create({
      data: {
        tenantId,
        branchId: other.id,
        referralType: 'DOCTOR',
        referralId: shared,
        branchLabTestListId: ids.docList,
      },
      select: { id: true },
    });
    assignmentIds.push(row.id);
    await expect(
      resolve({ referredByDoctorId: shared }),
    ).resolves.toMatchObject({
      source: 'DEFAULT',
    });
  });
});
