/**
 * Backfill the dedicated `UserDepartmentAssignment` table from the legacy
 * "Assign Department" rows that used to live in `department_person_mappings`.
 *
 * Department membership ("Assign Department" on the Users list) was previously
 * stored as `DepartmentPersonMapping` rows with `type=USER, branchId=null,
 * isSignatory=false`. That conflated membership with report signatories, so a
 * user assigned to a department wrongly surfaced in the department form's Person
 * Mapping / signatory list. Membership now has its own table; this one-off script
 * migrates the existing data. Per tenant (RLS-scoped via `runWithTenant`):
 *   1. read the legacy membership rows (`type=USER, branch_id NULL,
 *      is_signatory=false, deleted_at NULL`);
 *   2. create the matching `UserDepartmentAssignment` (carrying `isDefault`),
 *      skipping any that already exist;
 *   3. soft-delete the copied legacy rows so they no longer appear in Person
 *      Mapping.
 *
 * IDEMPOTENT: on re-run the legacy rows are already soft-deleted (nothing to
 * copy), and existing assignments are skipped before create.
 *
 * NOTE on the selector: a genuine Person Mapping row of `type=USER` that was left
 * NON-signatory (`is_signatory=false`, `branch_id NULL`) is indistinguishable
 * from an Assign-Department row and would also be migrated. This is acceptable —
 * Person Mapping exists to designate signatories (`is_signatory=true`), which are
 * excluded here, and this is a low-volume pre-production dataset. Signatory rows
 * (`is_signatory=true`) and branch-scoped rows are never touched.
 *
 * Run:  pnpm backfill:user-department-assignments
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { PersonMappingType } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const logger = new Logger('UserDepartmentAssignmentBackfill');

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);

  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    logger.log(`Scanning ${tenants.length} tenants for legacy membership rows…`);

    let migrated = 0;
    let skipped = 0;
    let softDeleted = 0;

    for (const { id: tenantId } of tenants) {
      await prisma.runWithTenant(tenantId, async () => {
        const legacy = await prisma.departmentPersonMapping.findMany({
          where: {
            tenantId,
            type: PersonMappingType.USER,
            branchId: null,
            isSignatory: false,
            deletedAt: null,
          },
          select: { id: true, departmentId: true, personId: true, isDefault: true },
        });
        if (legacy.length === 0) {
          return;
        }

        for (const row of legacy) {
          const already = await prisma.userDepartmentAssignment.findFirst({
            where: {
              tenantId,
              personId: row.personId,
              departmentId: row.departmentId,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (already) {
            skipped++;
          } else {
            await prisma.userDepartmentAssignment.create({
              data: {
                tenantId,
                departmentId: row.departmentId,
                personId: row.personId,
                isDefault: row.isDefault,
              },
            });
            migrated++;
          }
        }

        // Soft-delete the copied legacy rows so they leave Person Mapping.
        const res = await prisma.departmentPersonMapping.updateMany({
          where: { id: { in: legacy.map((r) => r.id) } },
          data: { deletedAt: new Date() },
        });
        softDeleted += res.count;
      });
    }

    logger.log(
      `Done. Created ${migrated} assignments, skipped ${skipped} existing, ` +
        `soft-deleted ${softDeleted} legacy mapping rows.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
