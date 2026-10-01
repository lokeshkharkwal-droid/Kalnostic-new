/**
 * Tenant → Tenant data-copy runner.
 *
 * Copies four domains from a SOURCE tenant (A) into a DESTINATION tenant (B) in
 * the same PostgreSQL database, WITHOUT creating duplicates for records already
 * present in B:
 *
 *   1. Users              — a TenantStaffMembership + tenant-level UserBranchProfile
 *                           rows for the SAME (platform-level, shared) Person.
 *                           Skipped when that person is already staff in B (i.e.
 *                           their email/mobile already exists in B — phone/email
 *                           are on the shared Person and are globally unique).
 *   2. Departments        — department definitions + tenant-level USER person
 *                           mappings + user↔department assignments, plus the
 *                           Category / SubCategory classification trees and their
 *                           own tenant-level USER person mappings (needed to
 *                           re-scope Master-Data lab-test classification).
 *   3. Business-Admin
 *      Master Data        — the Tenant Master Data singleton's Lab Tests (with
 *                           samples, result params, reference ranges/values) and
 *                           Lab Panels (with membership), classification ids
 *                           re-mapped onto B's copied departments/categories.
 *   4. Lab Adapters       — the adapter DEFINITIONS only (fresh token). Their
 *                           branch/test junctions are branch-scoped and out of
 *                           scope (see the "tenant-level only" decision below).
 *
 * SCOPE (confirmed): tenant-level only — every row carrying a `branchId` is
 * skipped (branch-level user profiles, adapter branch/test mappings, branch
 * operational lists, branch-scoped department mappings). No branch A→B mapping is
 * attempted. Skipped branch-scoped rows are counted and reported.
 *
 * The run is IDEMPOTENT: each stage checks B for an existing active row before
 * creating (person-already-staff / dept name / category+sub name / testCode /
 * panelCode / adapter name). Re-running only fills gaps.
 *
 * RLS: source (A) reads run inside `prisma.runWithTenant(A, …)`; destination (B)
 * writes run inside `prisma.withTenant(B, …)` transactions (or via the reused
 * services, which open their own B transaction). Platform tables (tenants,
 * persons) have no RLS and are read directly.
 *
 * Configuration (environment variables — put them in `.env` or export in the
 * shell; read verbatim, NOT validated by the app env schema):
 *   SRC_TENANT_ID   (required) source tenant id (A)
 *   DEST_TENANT_ID  (required) destination tenant id (B)
 *
 * Run:  SRC_TENANT_ID=… DEST_TENANT_ID=… pnpm migrate:tenant-copy
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  AdapterStatus,
  CategoryType,
  DataSource,
  PersonMappingType,
  Prisma,
  SubCategoryType,
} from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DepartmentService } from '../src/modules/department/department.service';
import { CategoryService } from '../src/modules/category/category.service';
import { SubCategoryService } from '../src/modules/sub-category/sub-category.service';
import { MasterDataService } from '../src/modules/master-data/master-data.service';

const logger = new Logger('TenantCopyMigration');

/** Read a required env var, trimmed; throw if missing/blank. */
function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var ${name}`);
  }
  return v.trim();
}

/** Meta / scope / provenance columns dropped when copying a LabTest row. */
const LAB_TEST_META = [
  'id',
  'tenantId',
  'branchId',
  'masterDataId',
  'source',
  'clonedFromId',
  'templateSyncedAt',
  'sourceMasterLabTestId',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'versionHistory',
];

/** Meta / scope / provenance columns dropped when copying a LabPanel row. */
const LAB_PANEL_META = [
  'id',
  'tenantId',
  'branchId',
  'masterDataId',
  'source',
  'sourceMasterLabPanelId',
  'createdAt',
  'updatedAt',
  'deletedAt',
];

/** Meta / scope columns dropped when copying a lab-test child row (samples/params). */
const CHILD_META = [
  'id',
  'tenantId',
  'branchId',
  'labTestId',
  'createdAt',
  'updatedAt',
  'deletedAt',
];

/** As CHILD_META plus `paramId` (dropped for reference ranges/values). */
const CHILD_META_WITH_PARAM = [...CHILD_META, 'paramId'];

/** Shallow-copy a row and delete the given keys. */
function stripKeys<T extends object>(
  row: T,
  keys: string[],
): Record<string, unknown> {
  const copy = { ...row } as Record<string, unknown>;
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

/** A running tally per domain, printed at the end. */
interface DomainReport {
  created: number;
  skipped: number;
  failed: number;
  notes: string[];
}
function newReport(): DomainReport {
  return { created: 0, skipped: 0, failed: 0, notes: [] };
}

async function main(): Promise<void> {
  const srcTenantId = req('SRC_TENANT_ID');
  const destTenantId = req('DEST_TENANT_ID');
  if (srcTenantId === destTenantId) {
    throw new Error('SRC_TENANT_ID and DEST_TENANT_ID must be different');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const departmentService = app.get(DepartmentService);
  const categoryService = app.get(CategoryService);
  const subCategoryService = app.get(SubCategoryService);
  const masterDataService = app.get(MasterDataService);

  const report = {
    users: newReport(),
    departments: newReport(),
    categories: newReport(),
    subCategories: newReport(),
    departmentMappings: newReport(),
    categoryMappings: newReport(),
    subCategoryMappings: newReport(),
    labTests: newReport(),
    labPanels: newReport(),
    overallResultTemplates: newReport(),
    labAdapters: newReport(),
  };

  try {
    // ── Validate both tenants exist (platform-level table, no RLS) ──
    const [srcTenant, destTenant] = await Promise.all([
      prisma.tenant.findFirst({
        where: { id: srcTenantId, deletedAt: null },
        select: { id: true, name: true },
      }),
      prisma.tenant.findFirst({
        where: { id: destTenantId, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);
    if (!srcTenant) {
      throw new Error(`Source tenant ${srcTenantId} not found`);
    }
    if (!destTenant) {
      throw new Error(`Destination tenant ${destTenantId} not found`);
    }
    logger.log(
      `Copying ${srcTenant.name} (${srcTenantId}) → ${destTenant.name} (${destTenantId})`,
    );

    // ── Shared: personIds that are already active staff in B ──
    // Drives the user skip-rule AND the department-mapping person guard.
    const destStaff = await prisma.runWithTenant(destTenantId, () =>
      prisma.tenantStaffMembership.findMany({
        where: { tenantId: destTenantId, deletedAt: null },
        select: { personId: true },
      }),
    );
    const destStaffPersonIds = new Set(destStaff.map((m) => m.personId));

    // ── Shared: AuthRole resolution A→B (by role key; global roles are shared) ──
    const destRoles = await prisma.runWithTenant(destTenantId, () =>
      prisma.authRole.findMany({
        where: {
          OR: [{ tenantId: destTenantId }, { tenantId: null }],
          deletedAt: null,
        },
        select: { id: true, key: true },
      }),
    );
    const destRoleIdByKey = new Map(destRoles.map((r) => [r.key, r.id]));
    const srcRoles = await prisma.runWithTenant(srcTenantId, () =>
      prisma.authRole.findMany({
        where: {
          OR: [{ tenantId: srcTenantId }, { tenantId: null }],
          deletedAt: null,
        },
        select: { id: true, key: true },
      }),
    );
    const srcRoleKeyById = new Map(srcRoles.map((r) => [r.id, r.key]));
    /** Resolve a source role id to the equivalent role id in B (by key). */
    const mapRoleId = (roleId: string | null): string | null => {
      if (!roleId) return null;
      const key = srcRoleKeyById.get(roleId);
      if (!key) return null;
      return destRoleIdByKey.get(key) ?? null;
    };

    await copyUsers(
      prisma,
      srcTenantId,
      destTenantId,
      destStaffPersonIds,
      mapRoleId,
      report.users,
    );

    const { deptIdMap, catIdMap, subIdMap } = await copyDepartments(
      prisma,
      srcTenantId,
      destTenantId,
      departmentService,
      categoryService,
      subCategoryService,
      destStaffPersonIds,
      report,
    );

    await copyMasterData(
      prisma,
      srcTenantId,
      destTenantId,
      masterDataService,
      deptIdMap,
      catIdMap,
      subIdMap,
      report,
    );

    await copyOverallResultTemplates(
      prisma,
      srcTenantId,
      destTenantId,
      report.overallResultTemplates,
    );

    await copyLabAdapters(
      prisma,
      srcTenantId,
      destTenantId,
      report.labAdapters,
    );

    // ── Summary ──
    logger.log('──────── Migration summary ────────');
    for (const [domain, r] of Object.entries(report)) {
      logger.log(
        `${domain}: created=${r.created} skipped=${r.skipped} failed=${r.failed}`,
      );
      for (const note of r.notes) {
        logger.log(`  • ${note}`);
      }
    }
    logger.log('───────────────────────────────────');
  } finally {
    await app.close();
  }
}

/**
 * Stage 1 — Users. Copy each of A's active staff memberships (and their
 * tenant-level UserBranchProfiles) onto the SAME shared Person in B. Skip a
 * person who is already active staff in B.
 */
async function copyUsers(
  prisma: PrismaService,
  srcTenantId: string,
  destTenantId: string,
  destStaffPersonIds: Set<string>,
  mapRoleId: (roleId: string | null) => string | null,
  report: DomainReport,
): Promise<void> {
  const memberships = await prisma.runWithTenant(srcTenantId, () =>
    prisma.tenantStaffMembership.findMany({
      where: { tenantId: srcTenantId, deletedAt: null },
    }),
  );
  // Tenant-level (branchId null) active profiles only — branch-level skipped.
  const tenantProfiles = await prisma.runWithTenant(srcTenantId, () =>
    prisma.userBranchProfile.findMany({
      where: {
        tenantId: srcTenantId,
        branchId: null,
        isActive: true,
        deletedAt: null,
      },
    }),
  );
  const branchProfileCount = await prisma.runWithTenant(srcTenantId, () =>
    prisma.userBranchProfile.count({
      where: {
        tenantId: srcTenantId,
        branchId: { not: null },
        deletedAt: null,
      },
    }),
  );
  if (branchProfileCount > 0) {
    report.notes.push(
      `${branchProfileCount} branch-level user profile(s) skipped (tenant-level only)`,
    );
  }

  const profilesByPerson = new Map<string, typeof tenantProfiles>();
  for (const p of tenantProfiles) {
    const list = profilesByPerson.get(p.personId) ?? [];
    list.push(p);
    profilesByPerson.set(p.personId, list);
  }

  for (const m of memberships) {
    if (destStaffPersonIds.has(m.personId)) {
      report.skipped += 1;
      continue;
    }
    try {
      await prisma.withTenant(destTenantId, async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: destTenantId },
          data: { staffCounter: { increment: 1 } },
          select: { staffCounter: true },
        });
        const userCode = `USR-${String(tenant.staffCounter).padStart(5, '0')}`;
        await tx.tenantStaffMembership.create({
          data: {
            tenantId: destTenantId,
            personId: m.personId,
            userCode,
            userType: m.userType,
            authRoleId: mapRoleId(m.authRoleId),
            status: m.status,
            // isPrimaryAdmin intentionally left false — B has its own primary admin.
          },
        });
        for (const p of profilesByPerson.get(m.personId) ?? []) {
          // A b2b_referring_panel profile is scoped to a ReferralPanel (out of
          // migration scope); copying it would drop referralPanelId and leave a
          // broken login. Skip and report instead of copying it malformed.
          if (p.referralPanelId) {
            report.notes.push(
              `b2b referral-panel profile for person ${m.personId} skipped (referral panel out of scope)`,
            );
            continue;
          }
          const roleId = mapRoleId(p.authRoleId);
          if (!roleId) {
            report.notes.push(
              `profile for person ${m.personId} skipped — role not found in destination`,
            );
            continue;
          }
          await tx.userBranchProfile.create({
            data: {
              tenantId: destTenantId,
              personId: m.personId,
              branchId: null,
              authRoleId: roleId,
              branchStatus: p.branchStatus,
              defaultModuleId: p.defaultModuleId,
              enabledModules: p.enabledModules,
              isDefault: p.isDefault,
              isActive: true,
              assignedAt: new Date(),
              assignedBy: null,
            },
          });
        }
      });
      // Prevent a second membership if the same person recurs (defensive).
      destStaffPersonIds.add(m.personId);
      report.created += 1;
    } catch (e) {
      report.failed += 1;
      report.notes.push(`user ${m.personId} failed: ${(e as Error).message}`);
    }
  }
}

/**
 * Stage 2 — Departments + Categories + SubCategories (+ tenant-level USER person
 * mappings and user↔department assignments). Reuses the domain services'
 * `create()` (system code generation + invariants) and returns the A→B id maps
 * the Master-Data stage needs to re-scope classification.
 */
async function copyDepartments(
  prisma: PrismaService,
  srcTenantId: string,
  destTenantId: string,
  departmentService: DepartmentService,
  categoryService: CategoryService,
  subCategoryService: SubCategoryService,
  destStaffPersonIds: Set<string>,
  report: {
    departments: DomainReport;
    categories: DomainReport;
    subCategories: DomainReport;
    departmentMappings: DomainReport;
    categoryMappings: DomainReport;
    subCategoryMappings: DomainReport;
  },
): Promise<{
  deptIdMap: Map<string, string>;
  catIdMap: Map<string, string>;
  subIdMap: Map<string, string>;
}> {
  const deptIdMap = new Map<string, string>();
  const catIdMap = new Map<string, string>();
  const subIdMap = new Map<string, string>();

  // ── Source (A) reads ──
  const srcDepts = await prisma.runWithTenant(srcTenantId, () =>
    prisma.department.findMany({
      where: { tenantId: srcTenantId, deletedAt: null },
    }),
  );
  const srcCats = await prisma.runWithTenant(srcTenantId, () =>
    prisma.category.findMany({
      where: { tenantId: srcTenantId, deletedAt: null },
    }),
  );
  const srcSubs = await prisma.runWithTenant(srcTenantId, () =>
    prisma.subCategory.findMany({
      where: { tenantId: srcTenantId, deletedAt: null },
    }),
  );
  const srcDeptMappings = await prisma.runWithTenant(srcTenantId, () =>
    prisma.departmentPersonMapping.findMany({
      where: { tenantId: srcTenantId, deletedAt: null },
    }),
  );
  const srcAssignments = await prisma.runWithTenant(srcTenantId, () =>
    prisma.userDepartmentAssignment.findMany({
      where: { tenantId: srcTenantId, deletedAt: null },
    }),
  );
  const srcCatMappings = await prisma.runWithTenant(srcTenantId, () =>
    prisma.categoryPersonMapping.findMany({
      where: { tenantId: srcTenantId, deletedAt: null },
    }),
  );
  const srcSubMappings = await prisma.runWithTenant(srcTenantId, () =>
    prisma.subCategoryPersonMapping.findMany({
      where: { tenantId: srcTenantId, deletedAt: null },
    }),
  );

  // ── Destination (B) existing rows for dedup ──
  const bDepts = await prisma.runWithTenant(destTenantId, () =>
    prisma.department.findMany({
      where: { tenantId: destTenantId, deletedAt: null },
      select: { id: true, name: true },
    }),
  );
  const bDeptIdByName = new Map(bDepts.map((d) => [d.name, d.id]));
  const bCats = await prisma.runWithTenant(destTenantId, () =>
    prisma.category.findMany({
      where: { tenantId: destTenantId, deletedAt: null },
      select: { id: true, name: true },
    }),
  );
  const bCatIdByName = new Map(bCats.map((c) => [c.name, c.id]));
  const bSubs = await prisma.runWithTenant(destTenantId, () =>
    prisma.subCategory.findMany({
      where: { tenantId: destTenantId, deletedAt: null },
      select: { id: true, name: true },
    }),
  );
  const bSubIdByName = new Map(bSubs.map((s) => [s.name, s.id]));

  const bMappings = await prisma.runWithTenant(destTenantId, () =>
    prisma.departmentPersonMapping.findMany({
      where: { tenantId: destTenantId, deletedAt: null },
      select: { departmentId: true, personId: true, position: true },
    }),
  );
  const bMappingKeys = new Set(
    bMappings.map((m) => `${m.departmentId}|${m.personId}|${m.position}`),
  );
  const bAssignments = await prisma.runWithTenant(destTenantId, () =>
    prisma.userDepartmentAssignment.findMany({
      where: { tenantId: destTenantId, deletedAt: null },
      select: { departmentId: true, personId: true },
    }),
  );
  const bAssignmentKeys = new Set(
    bAssignments.map((a) => `${a.departmentId}|${a.personId}`),
  );

  // ── Departments ──
  for (const dept of srcDepts) {
    const existingId = bDeptIdByName.get(dept.name);
    if (existingId) {
      deptIdMap.set(dept.id, existingId);
      report.departments.skipped += 1;
      continue;
    }
    try {
      const created = await createDepartmentSafe(
        departmentService,
        destTenantId,
        {
          name: dept.name,
          shortName: dept.shortName ?? undefined,
          description: dept.description ?? undefined,
          isActive: dept.isActive,
          moduleMapping: dept.moduleMapping,
        },
      );
      deptIdMap.set(dept.id, created.id);
      bDeptIdByName.set(dept.name, created.id);
      report.departments.created += 1;
    } catch (e) {
      report.departments.failed += 1;
      report.departments.notes.push(
        `department "${dept.name}" failed: ${(e as Error).message}`,
      );
    }
  }

  // ── Categories (need dept map for UNDER_DEPARTMENT) ──
  for (const cat of srcCats) {
    const existingId = bCatIdByName.get(cat.name);
    if (existingId) {
      catIdMap.set(cat.id, existingId);
      report.categories.skipped += 1;
      continue;
    }
    let destDeptId: string | undefined;
    if (cat.categoryType === CategoryType.UNDER_DEPARTMENT) {
      destDeptId = cat.departmentId
        ? deptIdMap.get(cat.departmentId)
        : undefined;
      if (!destDeptId) {
        report.categories.failed += 1;
        report.categories.notes.push(
          `category "${cat.name}" skipped — parent department not copied`,
        );
        continue;
      }
    }
    try {
      const created = await createCategorySafe(categoryService, destTenantId, {
        name: cat.name,
        shortName: cat.shortName ?? undefined,
        description: cat.description ?? undefined,
        isActive: cat.isActive,
        categoryType: cat.categoryType,
        departmentId: destDeptId,
        moduleMapping: cat.moduleMapping,
      });
      catIdMap.set(cat.id, created.id);
      bCatIdByName.set(cat.name, created.id);
      report.categories.created += 1;
    } catch (e) {
      report.categories.failed += 1;
      report.categories.notes.push(
        `category "${cat.name}" failed: ${(e as Error).message}`,
      );
    }
  }

  // ── SubCategories (need dept + category maps) ──
  for (const sub of srcSubs) {
    const existingId = bSubIdByName.get(sub.name);
    if (existingId) {
      subIdMap.set(sub.id, existingId);
      report.subCategories.skipped += 1;
      continue;
    }
    let destDeptId: string | undefined;
    let destCatId: string | undefined;
    if (sub.subCategoryType === SubCategoryType.UNDER_DEPARTMENT) {
      destDeptId = sub.departmentId
        ? deptIdMap.get(sub.departmentId)
        : undefined;
      if (!destDeptId) {
        report.subCategories.failed += 1;
        report.subCategories.notes.push(
          `sub-category "${sub.name}" skipped — parent department not copied`,
        );
        continue;
      }
    } else if (sub.subCategoryType === SubCategoryType.UNDER_CATEGORY) {
      destCatId = sub.categoryId ? catIdMap.get(sub.categoryId) : undefined;
      if (!destCatId) {
        report.subCategories.failed += 1;
        report.subCategories.notes.push(
          `sub-category "${sub.name}" skipped — parent category not copied`,
        );
        continue;
      }
    }
    try {
      const created = await createSubCategorySafe(
        subCategoryService,
        destTenantId,
        {
          name: sub.name,
          shortName: sub.shortName ?? undefined,
          description: sub.description ?? undefined,
          isActive: sub.isActive,
          subCategoryType: sub.subCategoryType,
          departmentId: destDeptId,
          categoryId: destCatId,
          moduleMapping: sub.moduleMapping,
        },
      );
      subIdMap.set(sub.id, created.id);
      bSubIdByName.set(sub.name, created.id);
      report.subCategories.created += 1;
    } catch (e) {
      report.subCategories.failed += 1;
      report.subCategories.notes.push(
        `sub-category "${sub.name}" failed: ${(e as Error).message}`,
      );
    }
  }

  // ── Department person mappings (tenant-level USER only) + user assignments ──
  let branchScopedMappings = 0;
  let nonUserMappings = 0;
  await prisma.withTenant(destTenantId, async (tx) => {
    for (const m of srcDeptMappings) {
      if (m.branchId !== null) {
        branchScopedMappings += 1;
        continue;
      }
      if (m.type !== PersonMappingType.USER) {
        nonUserMappings += 1;
        continue;
      }
      const destDeptId = deptIdMap.get(m.departmentId);
      if (!destDeptId) {
        report.departmentMappings.failed += 1;
        continue;
      }
      if (!destStaffPersonIds.has(m.personId)) {
        report.departmentMappings.notes.push(
          `mapping for person ${m.personId} skipped — not staff in destination`,
        );
        report.departmentMappings.skipped += 1;
        continue;
      }
      const key = `${destDeptId}|${m.personId}|${m.position}`;
      if (bMappingKeys.has(key)) {
        report.departmentMappings.skipped += 1;
        continue;
      }
      await tx.departmentPersonMapping.create({
        data: {
          tenantId: destTenantId,
          departmentId: destDeptId,
          personId: m.personId,
          type: PersonMappingType.USER,
          branchId: null,
          position: m.position,
          isSignatory: m.isSignatory,
          priority: m.priority,
          isDefault: m.isDefault,
        },
      });
      bMappingKeys.add(key);
      report.departmentMappings.created += 1;
    }

    for (const a of srcAssignments) {
      const destDeptId = deptIdMap.get(a.departmentId);
      if (!destDeptId) {
        continue;
      }
      if (!destStaffPersonIds.has(a.personId)) {
        continue;
      }
      const key = `${destDeptId}|${a.personId}`;
      if (bAssignmentKeys.has(key)) {
        continue;
      }
      await tx.userDepartmentAssignment.create({
        data: {
          tenantId: destTenantId,
          departmentId: destDeptId,
          personId: a.personId,
          isDefault: a.isDefault,
        },
      });
      bAssignmentKeys.add(key);
    }
  });
  if (branchScopedMappings > 0) {
    report.departmentMappings.notes.push(
      `${branchScopedMappings} branch-scoped mapping(s) skipped (tenant-level only)`,
    );
  }
  if (nonUserMappings > 0) {
    report.departmentMappings.notes.push(
      `${nonUserMappings} non-USER mapping(s) skipped (doctor/external-referral out of scope)`,
    );
  }

  // ── Category person mappings (tenant-level USER only) ──
  const bCatMappings = await prisma.runWithTenant(destTenantId, () =>
    prisma.categoryPersonMapping.findMany({
      where: { tenantId: destTenantId, deletedAt: null },
      select: { categoryId: true, personId: true, position: true },
    }),
  );
  const bCatMappingKeys = new Set(
    bCatMappings.map((m) => `${m.categoryId}|${m.personId}|${m.position}`),
  );
  let catBranchScoped = 0;
  let catNonUser = 0;
  await prisma.withTenant(destTenantId, async (tx) => {
    for (const m of srcCatMappings) {
      if (m.branchId !== null) {
        catBranchScoped += 1;
        continue;
      }
      if (m.type !== PersonMappingType.USER) {
        catNonUser += 1;
        continue;
      }
      const destCatId = catIdMap.get(m.categoryId);
      if (!destCatId) {
        report.categoryMappings.failed += 1;
        continue;
      }
      if (!destStaffPersonIds.has(m.personId)) {
        report.categoryMappings.skipped += 1;
        continue;
      }
      const key = `${destCatId}|${m.personId}|${m.position}`;
      if (bCatMappingKeys.has(key)) {
        report.categoryMappings.skipped += 1;
        continue;
      }
      await tx.categoryPersonMapping.create({
        data: {
          tenantId: destTenantId,
          categoryId: destCatId,
          personId: m.personId,
          type: PersonMappingType.USER,
          branchId: null,
          position: m.position,
          isSignatory: m.isSignatory,
          priority: m.priority,
          isDefault: m.isDefault,
        },
      });
      bCatMappingKeys.add(key);
      report.categoryMappings.created += 1;
    }
  });
  if (catBranchScoped > 0) {
    report.categoryMappings.notes.push(
      `${catBranchScoped} branch-scoped mapping(s) skipped (tenant-level only)`,
    );
  }
  if (catNonUser > 0) {
    report.categoryMappings.notes.push(
      `${catNonUser} non-USER mapping(s) skipped (doctor/external-referral out of scope)`,
    );
  }

  // ── Sub-category person mappings (tenant-level USER only) ──
  const bSubMappings = await prisma.runWithTenant(destTenantId, () =>
    prisma.subCategoryPersonMapping.findMany({
      where: { tenantId: destTenantId, deletedAt: null },
      select: { subCategoryId: true, personId: true, position: true },
    }),
  );
  const bSubMappingKeys = new Set(
    bSubMappings.map((m) => `${m.subCategoryId}|${m.personId}|${m.position}`),
  );
  let subBranchScoped = 0;
  let subNonUser = 0;
  await prisma.withTenant(destTenantId, async (tx) => {
    for (const m of srcSubMappings) {
      if (m.branchId !== null) {
        subBranchScoped += 1;
        continue;
      }
      if (m.type !== PersonMappingType.USER) {
        subNonUser += 1;
        continue;
      }
      const destSubId = subIdMap.get(m.subCategoryId);
      if (!destSubId) {
        report.subCategoryMappings.failed += 1;
        continue;
      }
      if (!destStaffPersonIds.has(m.personId)) {
        report.subCategoryMappings.skipped += 1;
        continue;
      }
      const key = `${destSubId}|${m.personId}|${m.position}`;
      if (bSubMappingKeys.has(key)) {
        report.subCategoryMappings.skipped += 1;
        continue;
      }
      await tx.subCategoryPersonMapping.create({
        data: {
          tenantId: destTenantId,
          subCategoryId: destSubId,
          personId: m.personId,
          type: PersonMappingType.USER,
          branchId: null,
          position: m.position,
          isSignatory: m.isSignatory,
          priority: m.priority,
          isDefault: m.isDefault,
        },
      });
      bSubMappingKeys.add(key);
      report.subCategoryMappings.created += 1;
    }
  });
  if (subBranchScoped > 0) {
    report.subCategoryMappings.notes.push(
      `${subBranchScoped} branch-scoped mapping(s) skipped (tenant-level only)`,
    );
  }
  if (subNonUser > 0) {
    report.subCategoryMappings.notes.push(
      `${subNonUser} non-USER mapping(s) skipped (doctor/external-referral out of scope)`,
    );
  }

  return { deptIdMap, catIdMap, subIdMap };
}

/**
 * Stage 3 — Business-Admin Master Data. Copies the Tenant Master Data singleton's
 * Lab Tests (with children) and Lab Panels (with membership) from A into B,
 * re-scoping classification onto B's copied departments/categories.
 */
async function copyMasterData(
  prisma: PrismaService,
  srcTenantId: string,
  destTenantId: string,
  masterDataService: MasterDataService,
  deptIdMap: Map<string, string>,
  catIdMap: Map<string, string>,
  subIdMap: Map<string, string>,
  report: { labTests: DomainReport; labPanels: DomainReport },
): Promise<void> {
  const srcMd = await prisma.runWithTenant(srcTenantId, () =>
    masterDataService.getOrCreateTenantMasterData(srcTenantId),
  );
  const destMd = await prisma.runWithTenant(destTenantId, () =>
    masterDataService.getOrCreateTenantMasterData(destTenantId),
  );

  /** Map a classification id from A→B, or null when unmapped. */
  const remap = (map: Map<string, string>, id: string | null): string | null =>
    id ? (map.get(id) ?? null) : null;

  // ── Lab Tests: load A's tests + children into memory ──
  const srcTests = await prisma.runWithTenant(srcTenantId, () =>
    prisma.labTest.findMany({
      where: { masterDataId: srcMd.id, tenantId: srcTenantId, deletedAt: null },
    }),
  );
  const srcTestIds = srcTests.map((t) => t.id);
  const [srcSamples, srcParams, srcRanges, srcValues] =
    await prisma.runWithTenant(srcTenantId, () =>
      Promise.all([
        prisma.labTestSample.findMany({
          where: {
            tenantId: srcTenantId,
            deletedAt: null,
            labTestId: { in: srcTestIds },
          },
        }),
        prisma.labTestResultParam.findMany({
          where: {
            tenantId: srcTenantId,
            deletedAt: null,
            labTestId: { in: srcTestIds },
          },
        }),
        prisma.labTestReferenceRange.findMany({
          where: {
            tenantId: srcTenantId,
            deletedAt: null,
            labTestId: { in: srcTestIds },
          },
        }),
        prisma.labTestReferenceValue.findMany({
          where: {
            tenantId: srcTenantId,
            deletedAt: null,
            labTestId: { in: srcTestIds },
          },
        }),
      ]),
    );
  const samplesByTest = groupBy(srcSamples, (s) => s.labTestId);
  const paramsByTest = groupBy(srcParams, (p) => p.labTestId);
  const rangesByTest = groupBy(srcRanges, (r) => r.labTestId);
  const valuesByTest = groupBy(srcValues, (v) => v.labTestId);

  // ── Destination existing tests for dedup + test id map (for panels) ──
  const bTests = await prisma.runWithTenant(destTenantId, () =>
    prisma.labTest.findMany({
      where: {
        masterDataId: destMd.id,
        tenantId: destTenantId,
        deletedAt: null,
      },
      select: { id: true, testName: true, testCode: true },
    }),
  );
  const bTestNames = new Set(bTests.map((t) => t.testName));
  const bTestCodes = new Set(bTests.map((t) => t.testCode));
  const bTestIdByCode = new Map(bTests.map((t) => [t.testCode, t.id]));
  const testIdMap = new Map<string, string>();

  for (const test of srcTests) {
    if (bTestNames.has(test.testName) || bTestCodes.has(test.testCode)) {
      // Already present — still map src→existing B id so panels resolve members.
      const existing = bTestIdByCode.get(test.testCode);
      if (existing) testIdMap.set(test.id, existing);
      report.labTests.skipped += 1;
      continue;
    }
    try {
      const newId = await prisma.withTenant(destTenantId, async (tx) => {
        const scalars = stripKeys(test, LAB_TEST_META);
        scalars.departmentId = remap(deptIdMap, test.departmentId);
        scalars.categoryId = remap(catIdMap, test.categoryId);
        scalars.subCategoryId = remap(subIdMap, test.subCategoryId);
        scalars.mandatoryDeptId = remap(deptIdMap, test.mandatoryDeptId);
        scalars.mandatoryCatId = remap(catIdMap, test.mandatoryCatId);
        scalars.mandatorySubcatId = remap(subIdMap, test.mandatorySubcatId);
        // Cross-module logical refs to out-of-scope config (report templates,
        // pdf/image settings) point at TENANT A entities we don't migrate; null
        // them so B never stores another tenant's id (they can't resolve in B).
        scalars.reportTemplateId = null;
        scalars.pdfSettingsId = null;
        scalars.imageSettingsId = null;

        const created = await tx.labTest.create({
          data: {
            ...scalars,
            tenantId: destTenantId,
            branchId: null,
            masterDataId: destMd.id,
            source: DataSource.TENANT,
            versionHistory: [
              {
                version: 1,
                effectiveFrom: new Date().toISOString().slice(0, 10),
                effectiveTo: null,
                modifiedBy: null,
                approvedBy: null,
              },
            ] as unknown as Prisma.InputJsonValue,
          } as unknown as Prisma.LabTestUncheckedCreateInput,
        });

        const samples = samplesByTest.get(test.id) ?? [];
        if (samples.length) {
          await tx.labTestSample.createMany({
            data: samples.map((s) => ({
              ...stripKeys(s, CHILD_META),
              tenantId: destTenantId,
              branchId: null,
              labTestId: created.id,
            })) as unknown as Prisma.LabTestSampleCreateManyInput[],
          });
        }

        for (const param of paramsByTest.get(test.id) ?? []) {
          const newParam = await tx.labTestResultParam.create({
            data: {
              ...stripKeys(param, CHILD_META),
              // Cross-module layout/settings/icon refs point at TENANT A config
              // we don't migrate — null them (they can't resolve in B).
              groupLayoutId: null,
              groupSettingsId: null,
              iconSettingsId: null,
              imageSettingsId: null,
              tenantId: destTenantId,
              branchId: null,
              labTestId: created.id,
            } as unknown as Prisma.LabTestResultParamUncheckedCreateInput,
          });
          const ranges = (rangesByTest.get(test.id) ?? []).filter(
            (r) => r.paramId === param.id,
          );
          if (ranges.length) {
            await tx.labTestReferenceRange.createMany({
              data: ranges.map((r) => ({
                ...stripKeys(r, CHILD_META_WITH_PARAM),
                // Analyzer scoping references a TENANT A LabAdapter; we copy
                // adapter definitions with NEW ids (and only after this stage),
                // so null it — NULL is the schema's valid "Default" (no analyzer).
                labAdapterId: null,
                tenantId: destTenantId,
                branchId: null,
                labTestId: created.id,
                paramId: newParam.id,
              })) as unknown as Prisma.LabTestReferenceRangeCreateManyInput[],
            });
          }
          const values = (valuesByTest.get(test.id) ?? []).filter(
            (v) => v.paramId === param.id,
          );
          if (values.length) {
            await tx.labTestReferenceValue.createMany({
              data: values.map((v) => ({
                ...stripKeys(v, CHILD_META_WITH_PARAM),
                tenantId: destTenantId,
                branchId: null,
                labTestId: created.id,
                paramId: newParam.id,
              })) as unknown as Prisma.LabTestReferenceValueCreateManyInput[],
            });
          }
        }
        return created.id;
      });
      testIdMap.set(test.id, newId);
      bTestNames.add(test.testName);
      bTestCodes.add(test.testCode);
      bTestIdByCode.set(test.testCode, newId);
      report.labTests.created += 1;
    } catch (e) {
      report.labTests.failed += 1;
      report.labTests.notes.push(
        `test "${test.testName}" failed: ${(e as Error).message}`,
      );
    }
  }

  // ── Remap reflex-test references onto B's copied tests ──
  // A result param's `reflexTests` JSON ([{ id, name }]) points at OTHER lab
  // tests in this same catalogue — which we DO copy — so translate each A test
  // id to its B id via `testIdMap` (mirrors panel-member remapping). Runs after
  // the test loop so `testIdMap` is complete (forward references resolve).
  // Idempotent/self-healing: an already-B id is kept, an A id is mapped, an
  // unresolvable id (target not in the copied set) is dropped.
  const copiedTestIds = [...testIdMap.values()];
  if (copiedTestIds.length) {
    const bTestIdSet = new Set(copiedTestIds);
    const bParams = await prisma.runWithTenant(destTenantId, () =>
      prisma.labTestResultParam.findMany({
        where: {
          tenantId: destTenantId,
          labTestId: { in: copiedTestIds },
          deletedAt: null,
        },
        select: { id: true, reflexTests: true },
      }),
    );
    const fixes: Array<{ id: string; reflex: Array<Record<string, unknown>> }> =
      [];
    let refsKept = 0;
    let refsDropped = 0;
    for (const p of bParams) {
      const entries = parseReflexTests(p.reflexTests);
      if (!entries.length) continue;
      const mapped = entries
        .map((e): Record<string, unknown> | null => {
          const srcId = typeof e.id === 'string' ? e.id : null;
          const newId = srcId
            ? (testIdMap.get(srcId) ?? (bTestIdSet.has(srcId) ? srcId : null))
            : null;
          return newId ? { ...e, id: newId } : null;
        })
        .filter((e): e is Record<string, unknown> => e !== null);
      refsKept += mapped.length;
      refsDropped += entries.length - mapped.length;
      fixes.push({ id: p.id, reflex: mapped });
    }
    if (fixes.length) {
      await prisma.withTenant(destTenantId, async (tx) => {
        for (const f of fixes) {
          await tx.labTestResultParam.update({
            where: { id: f.id },
            data: {
              reflexTests: f.reflex as unknown as Prisma.InputJsonValue,
            },
          });
        }
      });
      report.labTests.notes.push(
        `reflex-test refs remapped on ${fixes.length} param(s): ${refsKept} kept` +
          (refsDropped
            ? `, ${refsDropped} dropped (target not in copied set)`
            : ''),
      );
    }
  }

  // ── Lab Panels ──
  const srcPanels = await prisma.runWithTenant(srcTenantId, () =>
    prisma.labPanel.findMany({
      where: { masterDataId: srcMd.id, tenantId: srcTenantId, deletedAt: null },
    }),
  );
  const srcPanelIds = srcPanels.map((p) => p.id);
  const srcMembers = await prisma.runWithTenant(srcTenantId, () =>
    prisma.labPanelTest.findMany({
      where: {
        tenantId: srcTenantId,
        deletedAt: null,
        labPanelId: { in: srcPanelIds },
      },
      orderBy: { sortOrder: 'asc' },
    }),
  );
  const membersByPanel = groupBy(srcMembers, (m) => m.labPanelId);

  const bPanels = await prisma.runWithTenant(destTenantId, () =>
    prisma.labPanel.findMany({
      where: {
        masterDataId: destMd.id,
        tenantId: destTenantId,
        deletedAt: null,
      },
      select: { panelCode: true },
    }),
  );
  const bPanelCodes = new Set(bPanels.map((p) => p.panelCode));

  for (const panel of srcPanels) {
    if (bPanelCodes.has(panel.panelCode)) {
      report.labPanels.skipped += 1;
      continue;
    }
    try {
      await prisma.withTenant(destTenantId, async (tx) => {
        const scalars = stripKeys(panel, LAB_PANEL_META);
        scalars.categoryId = remap(catIdMap, panel.categoryId);
        scalars.departmentId = remap(deptIdMap, panel.departmentId);
        const created = await tx.labPanel.create({
          data: {
            ...scalars,
            tenantId: destTenantId,
            branchId: null,
            masterDataId: destMd.id,
            source: DataSource.TENANT,
          } as unknown as Prisma.LabPanelUncheckedCreateInput,
        });
        const joinRows = (membersByPanel.get(panel.id) ?? [])
          .map((m) => ({
            labTestId: testIdMap.get(m.labTestId),
            sortOrder: m.sortOrder,
            isRemovable: m.isRemovable,
            discountPercent: m.discountPercent,
          }))
          .filter(
            (
              r,
            ): r is {
              labTestId: string;
              sortOrder: number;
              isRemovable: boolean;
              discountPercent: number | null;
            } => Boolean(r.labTestId),
          );
        if (joinRows.length) {
          await tx.labPanelTest.createMany({
            data: joinRows.map((r) => ({
              ...r,
              tenantId: destTenantId,
              branchId: null,
              labPanelId: created.id,
            })),
          });
        }
      });
      bPanelCodes.add(panel.panelCode);
      report.labPanels.created += 1;
    } catch (e) {
      report.labPanels.failed += 1;
      report.labPanels.notes.push(
        `panel "${panel.panelName}" failed: ${(e as Error).message}`,
      );
    }
  }
}

/**
 * Stage 3b — Overall Result Templates. A tenant-scoped Business-Admin settings
 * entity linked to result params by `groupName` (string, no FK) — the params'
 * `overallResultGroups` names, copied verbatim, resolve against these. Copied by
 * value (no id remap); deduped by `name` (unique per tenant among active rows).
 */
async function copyOverallResultTemplates(
  prisma: PrismaService,
  srcTenantId: string,
  destTenantId: string,
  report: DomainReport,
): Promise<void> {
  const srcTemplates = await prisma.runWithTenant(srcTenantId, () =>
    prisma.overallResultTemplate.findMany({
      where: { tenantId: srcTenantId, deletedAt: null },
    }),
  );
  const bTemplates = await prisma.runWithTenant(destTenantId, () =>
    prisma.overallResultTemplate.findMany({
      where: { tenantId: destTenantId, deletedAt: null },
      select: { name: true },
    }),
  );
  const bNames = new Set(bTemplates.map((t) => t.name));

  for (const tpl of srcTemplates) {
    if (bNames.has(tpl.name)) {
      report.skipped += 1;
      continue;
    }
    try {
      await prisma.withTenant(destTenantId, (tx) =>
        tx.overallResultTemplate.create({
          data: {
            tenantId: destTenantId,
            name: tpl.name,
            groupName: tpl.groupName,
            content: tpl.content,
            status: tpl.status,
          },
        }),
      );
      bNames.add(tpl.name);
      report.created += 1;
    } catch (e) {
      report.failed += 1;
      report.notes.push(
        `overall-result-template "${tpl.name}" failed: ${(e as Error).message}`,
      );
    }
  }
}

/**
 * Stage 4 — Lab Adapters (definitions only). A fresh globally-unique token is
 * generated for each copy; branch/test junctions are branch-scoped and skipped.
 */
async function copyLabAdapters(
  prisma: PrismaService,
  srcTenantId: string,
  destTenantId: string,
  report: DomainReport,
): Promise<void> {
  const srcAdapters = await prisma.runWithTenant(srcTenantId, () =>
    prisma.labAdapter.findMany({
      where: { tenantId: srcTenantId, deletedAt: null },
    }),
  );
  const [branchJunctions, testJunctions] = await prisma.runWithTenant(
    srcTenantId,
    () =>
      Promise.all([
        prisma.labAdapterBranch.count({
          where: { tenantId: srcTenantId, deletedAt: null },
        }),
        prisma.labAdapterTest.count({
          where: { tenantId: srcTenantId, deletedAt: null },
        }),
      ]),
  );
  if (branchJunctions > 0 || testJunctions > 0) {
    report.notes.push(
      `${branchJunctions} branch + ${testJunctions} test junction(s) skipped (reassign in destination)`,
    );
  }

  const bAdapters = await prisma.runWithTenant(destTenantId, () =>
    prisma.labAdapter.findMany({
      where: { tenantId: destTenantId, deletedAt: null },
      select: { name: true },
    }),
  );
  const bAdapterNames = new Set(bAdapters.map((a) => a.name));

  for (const adapter of srcAdapters) {
    if (bAdapterNames.has(adapter.name)) {
      report.skipped += 1;
      continue;
    }
    try {
      await prisma.withTenant(destTenantId, (tx) =>
        tx.labAdapter.create({
          data: {
            tenantId: destTenantId,
            name: adapter.name,
            token: randomBytes(32).toString('hex'),
            equipmentId: adapter.equipmentId,
            status: adapter.status ?? AdapterStatus.ONLINE,
          },
        }),
      );
      bAdapterNames.add(adapter.name);
      report.created += 1;
    } catch (e) {
      report.failed += 1;
      report.notes.push(
        `adapter "${adapter.name}" failed: ${(e as Error).message}`,
      );
    }
  }
}

/**
 * Parse a `LabTestResultParam.reflexTests` JSON value into the array of
 * `{ id, name, … }` objects it holds (only well-formed object entries carrying
 * an `id`). Returns `[]` for null / non-array / malformed values.
 */
function parseReflexTests(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is Record<string, unknown> =>
      typeof e === 'object' && e !== null && 'id' in e,
  );
}

/** Group an array into a Map keyed by the given selector. */
function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
}

/** Create a department, retrying once without shortName on a conflict. */
async function createDepartmentSafe(
  service: DepartmentService,
  tenantId: string,
  dto: {
    name: string;
    shortName?: string;
    description?: string;
    isActive: boolean;
    moduleMapping: Prisma.DepartmentCreateInput['moduleMapping'];
  },
): Promise<{ id: string }> {
  try {
    return await service.create(tenantId, dto as never);
  } catch (e) {
    if (dto.shortName) {
      return service.create(tenantId, {
        ...dto,
        shortName: undefined,
      } as never);
    }
    throw e;
  }
}

/** Create a category, retrying once without shortName on a conflict. */
async function createCategorySafe(
  service: CategoryService,
  tenantId: string,
  dto: {
    name: string;
    shortName?: string;
    description?: string;
    isActive: boolean;
    categoryType: CategoryType;
    departmentId?: string;
    moduleMapping: Prisma.CategoryCreateInput['moduleMapping'];
  },
): Promise<{ id: string }> {
  try {
    return await service.create(tenantId, dto as never);
  } catch (e) {
    if (dto.shortName) {
      return service.create(tenantId, {
        ...dto,
        shortName: undefined,
      } as never);
    }
    throw e;
  }
}

/** Create a sub-category, retrying once without shortName on a conflict. */
async function createSubCategorySafe(
  service: SubCategoryService,
  tenantId: string,
  dto: {
    name: string;
    shortName?: string;
    description?: string;
    isActive: boolean;
    subCategoryType: SubCategoryType;
    departmentId?: string;
    categoryId?: string;
    moduleMapping: Prisma.SubCategoryCreateInput['moduleMapping'];
  },
): Promise<{ id: string }> {
  try {
    return await service.create(tenantId, dto as never);
  } catch (e) {
    if (dto.shortName) {
      return service.create(tenantId, {
        ...dto,
        shortName: undefined,
      } as never);
    }
    throw e;
  }
}

main().catch((e) => {
  logger.error(e instanceof Error ? e.stack : String(e));
  process.exitCode = 1;
});
