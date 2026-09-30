const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const paramId = '0778a219-ebff-4768-bdd5-bfd30a6c61ae';
  const ranges = await prisma.labTestReferenceRange.findMany({ where: { paramId, deletedAt: null } });
  ranges.forEach(r => console.log(JSON.stringify({
    method: r.method, gender: r.gender,
    ageFrom: r.ageFrom, ageFromUnit: r.ageFromUnit,
    ageTo: r.ageTo, ageToUnit: r.ageToUnit,
    isDefault: r.isDefault, display: r.displayOfReferenceRange
  })));
  await prisma.$disconnect();
})();
