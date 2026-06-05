import { PrismaClient, SiteAdminRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@kalnostics.com';
  const plainPassword = 'SuperSecret1';
  
  // Check if admin already exists
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

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
