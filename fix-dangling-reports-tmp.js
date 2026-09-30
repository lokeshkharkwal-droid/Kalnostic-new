const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tenantId = 'ef076513-c17a-40fd-8d0c-9c930c2968a3';
  await prisma.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantId}', false)`);

  const reports = await prisma.labReport.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true, labTestId: true, memberBranchLabTestId: true,
      orderItem: { select: { branchLabTestId: true, branchLabPanelId: true } },
    },
  });

  const toBackfill = [];
  const toSoftDelete = [];

  for (const r of reports) {
    const testId = r.memberBranchLabTestId ?? r.labTestId;
    if (!testId) continue;
    const blt = await prisma.branchLabTest.findUnique({ where: { id: testId }, select: { deletedAt: true, sourceLabTestId: true } });
    const lt = blt ? null : await prisma.labTest.findUnique({ where: { id: testId }, select: { deletedAt: true } });
    const resolved = blt || lt;
    const isOk = resolved && !resolved.deletedAt;
    if (isOk) continue; // already fine

    if (r.orderItem.branchLabPanelId) {
      // Panel-member report whose member is gone/deleted - check if panel itself still lives.
      const panel = await prisma.branchLabPanel.findUnique({ where: { id: r.orderItem.branchLabPanelId }, select: { deletedAt: true } });
      if (panel && panel.deletedAt) {
        toSoftDelete.push(r.id);
      } else {
        console.log(`SKIP (needs manual review) report=${r.id} - panel still live but member dangling`);
      }
      continue;
    }

    // Direct-test report - backfill from the order item's CURRENT branchLabTestId's sourceLabTestId.
    if (r.orderItem.branchLabTestId) {
      const currentBlt = await prisma.branchLabTest.findUnique({ where: { id: r.orderItem.branchLabTestId }, select: { sourceLabTestId: true, deletedAt: true } });
      if (currentBlt && !currentBlt.deletedAt && currentBlt.sourceLabTestId) {
        toBackfill.push({ reportId: r.id, newLabTestId: currentBlt.sourceLabTestId });
      } else {
        console.log(`SKIP (no live source) report=${r.id}`);
      }
    } else {
      console.log(`SKIP (no orderItem.branchLabTestId) report=${r.id}`);
    }
  }

  console.log('\nPlanned backfills:', toBackfill.length);
  toBackfill.forEach(b => console.log(' ', b));
  console.log('\nPlanned soft-deletes:', toSoftDelete.length);
  toSoftDelete.forEach(id => console.log(' ', id));

  console.log('\n--- Applying fixes in a transaction ---');
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const b of toBackfill) {
      await tx.labReport.update({ where: { id: b.reportId }, data: { labTestId: b.newLabTestId } });
    }
    if (toSoftDelete.length) {
      await tx.labReport.updateMany({ where: { id: { in: toSoftDelete } }, data: { deletedAt: now } });
    }
  });
  console.log('Done.');
}
main().finally(() => prisma.$disconnect());
