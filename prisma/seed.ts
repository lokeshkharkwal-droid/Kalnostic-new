import { PrismaClient, SiteAdminRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  PROFILE_BRANCH_MATRIX,
  PROFILE_LABELS,
  PROFILE_REGISTRY,
} from '../src/modules/permissions/constants/profile-registry.constant';

const prisma = new PrismaClient();

/**
 * Seed the default platform SiteAdmin (SUPER_OWNER). Idempotent: skips if the
 * account already exists.
 */
async function seedSiteAdmin(): Promise<void> {
  const email = 'admin@kalnostics.com';
  const plainPassword = 'SuperSecret1';

  const existingAdmin = await prisma.siteAdminUser.findFirst({
    where: { email, deletedAt: null },
  });
  if (existingAdmin) {
    console.log(`SiteAdminUser with email ${email} already exists.`);
    return;
  }

  const passwordHash = await bcrypt.hash(plainPassword, 12);
  await prisma.siteAdminUser.create({
    data: {
      firstName: 'Super',
      lastName: 'Admin',
      email,
      passwordHash,
      role: SiteAdminRole.SUPER_OWNER,
      isActive: true,
    },
  });
  console.log(`Seeded default SiteAdminUser:`);
  console.log(`Email: ${email}`);
  console.log(`Password: ${plainPassword}`);
}

/**
 * Seed the global system roles (tenant_id = NULL) from PROFILE_REGISTRY — the
 * single source of truth for the built-in roles every tenant shares. Idempotent
 * and safe to re-run: each key is matched (find-then-create/update), so no
 * duplicates are ever created. `name` and `allowedBranchTypes` are kept in sync
 * with the code constants (system-role names are immutable via the API);
 * `isActive` is left untouched on existing rows so an admin's toggle survives.
 */
async function seedSystemRoles(): Promise<void> {
  let created = 0;
  let updated = 0;
  for (const key of PROFILE_REGISTRY) {
    const name = PROFILE_LABELS[key];
    const allowedBranchTypes = PROFILE_BRANCH_MATRIX[key] ?? [];
    const existing = await prisma.authRole.findFirst({
      where: { key, tenantId: null },
    });
    if (existing) {
      await prisma.authRole.update({
        where: { id: existing.id },
        data: { name, allowedBranchTypes, isSystem: true, deletedAt: null },
      });
      updated += 1;
    } else {
      await prisma.authRole.create({
        data: {
          tenantId: null,
          key,
          name,
          allowedBranchTypes,
          isSystem: true,
          isActive: true,
        },
      });
      created += 1;
    }
  }
  console.log(
    `Seeded system roles: ${created} created, ${updated} updated ` +
      `(${PROFILE_REGISTRY.length} total).`,
  );
}

async function main() {
  await seedSiteAdmin();
  await seedSystemRoles();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
