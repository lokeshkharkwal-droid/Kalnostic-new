const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const tenantId = 'ef076513-c17a-40fd-8d0c-9c930c2968a3';
  const branchId = 'a9d35cb8-1aea-424a-828f-d3dcfdc74e1d';

  // LabReport.labTestId is a logical ref to LabTest (tenant or branch master
  // data copy). Find every distinct labTestId referenced by an active report.
  const reports = await prisma.labReport.findMany({
    where: { deletedAt: null },
    select: { id: true, labTestId: true, memberBranchLabTestId: true },
  });
  console.log('total active LabReports:', reports.length);

  const labTestIds = [...new Set(reports.map(r => r.labTestId).filter(Boolean))];
  console.log('distinct labTestId values referenced:', labTestIds.length);

  const tests = await prisma.labTest.findMany({
    where: { id: { in: labTestIds } },
    select: { id: true, testName: true, testCode: true, branchId: true, tenantId: true, deletedAt: true },
  });
  console.log('resolved LabTest rows:', JSON.stringify(tests, null, 2));
}
main().finally(() => prisma.$disconnect());
