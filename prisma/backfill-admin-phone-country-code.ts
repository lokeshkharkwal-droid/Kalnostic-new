/**
 * One-off backfill: strip the country-code prefix from existing business-admin
 * login phones so they match the new "plain 10-digit" storage format. The
 * business contact phone (`tenants.phone`) is left untouched — only the admin's
 * login identifier (`persons.phone` + `person_credentials.phone`) is normalised.
 *
 * Business-admin persons are discovered via their tenant-level `business_admin`
 * `UserBranchProfile` (read per-tenant with RLS context); `persons` and
 * `person_credentials` are platform-level (no RLS) so they're updated directly.
 *
 * Idempotent — already-10-digit values are skipped. Uniqueness is guarded: if
 * the stripped value collides with another person, the record is skipped and
 * logged rather than throwing. Run:
 *   pnpm -C kalnostics-new exec ts-node prisma/backfill-admin-phone-country-code.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** Known dialling codes (from the FE PhoneInput), longest first. */
const COUNTRY_CODES = ['+977', '+971', '+94', '+91'];

/** Strip a known leading dialling code; returns the value unchanged if none. */
function stripCountryCode(phone: string): string {
  for (const code of COUNTRY_CODES) {
    if (phone.startsWith(code)) return phone.slice(code.length);
  }
  return phone;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  const prisma = app.get(PrismaService);

  // 1. Collect business-admin person ids (per-tenant, inside RLS context).
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const personIds = new Set<string>();
  for (const tenant of tenants) {
    await prisma.withTenant(tenant.id, async (tx) => {
      const profiles = await tx.userBranchProfile.findMany({
        where: {
          authRole: { key: 'business_admin' },
          branchId: null,
          deletedAt: null,
        },
        select: { personId: true },
      });
      for (const p of profiles) personIds.add(p.personId);
    });
  }

  let updated = 0;
  let skippedNoChange = 0;
  let skippedCollision = 0;

  // 2. Normalise each admin's login phone (platform-level, no RLS).
  for (const personId of personIds) {
    const person = await prisma.person.findFirst({
      where: { id: personId, deletedAt: null },
      select: { id: true, phone: true },
    });
    if (!person?.phone) {
      skippedNoChange += 1;
      continue;
    }

    const stripped = stripCountryCode(person.phone);
    if (stripped === person.phone) {
      skippedNoChange += 1;
      continue;
    }

    // Guard uniqueness against other persons / other credentials.
    const [personClash, credClash] = await Promise.all([
      prisma.person.findFirst({
        where: { phone: stripped, id: { not: person.id }, deletedAt: null },
        select: { id: true },
      }),
      prisma.personCredentials.findFirst({
        where: { phone: stripped, personId: { not: person.id } },
        select: { id: true },
      }),
    ]);
    if (personClash || credClash) {
      skippedCollision += 1;
      // eslint-disable-next-line no-console
      console.warn(
        `Skipped person ${person.id}: stripped phone "${stripped}" already in use.`,
      );
      continue;
    }

    await prisma.$transaction([
      prisma.person.update({
        where: { id: person.id },
        data: { phone: stripped },
      }),
      prisma.personCredentials.updateMany({
        where: { personId: person.id },
        data: { phone: stripped },
      }),
    ]);
    updated += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `Admin phone backfill complete: ${updated} updated, ${skippedNoChange} unchanged, ${skippedCollision} skipped (collision), across ${personIds.size} business-admin(s).`,
  );
  await app.close();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
