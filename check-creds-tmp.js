const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const c = await prisma.personCredentials.findFirst({ where: { email: 'testadmin@kalnostics.com' } });
  console.log(JSON.stringify({ failedAttempts: c.failedAttempts, lockedUntil: c.lockedUntil, lastLoginAt: c.lastLoginAt }, null, 2));
  await prisma.$disconnect();
})();
