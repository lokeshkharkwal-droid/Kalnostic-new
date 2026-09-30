const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const tenantId = 'ef076513-c17a-40fd-8d0c-9c930c2968a3';
  await prisma.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantId}', false)`);

  const reports = await prisma.labReport.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, labTestId: true, memberBranchLabTestId: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log('All reports (oldest first):');
  for (const r of reports) {
    console.log(r.id, 'status=', r.status, 'created=', r.createdAt.toISOString());
  }

  console.log('\n--- Checking for any saved result values across ALL reports ---');
  const values = await prisma.labReportResultValue.findMany({ where: { tenantId } });
  console.log('Total LabReportResultValue rows in tenant:', values.length);
  for (const v of values) {
    console.log(JSON.stringify(v, null, 2));
  }
}
main().finally(() => prisma.$disconnect());
