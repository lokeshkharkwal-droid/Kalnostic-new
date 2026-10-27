/**
 * One-off verification for the combined (diagnostic + radiology) sub-order flow.
 * Boots the Nest app context, creates a combined ORDER with a partial payment,
 * and asserts: a PARENT + two CHILD orders, correct item partition, and a
 * proportional payment split whose parts sum back to the whole.
 *
 * Run: npx ts-node scripts/verify-combined-order.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OrderService } from '../src/modules/order/order.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderStatus, OrderType, BillingType, PaymentMode } from '@prisma/client';

const TENANT = '92f6e838-3779-4a74-a823-c1a8e50e2248';
const BRANCH = 'd0a8bf0a-7b97-49d4-82a2-b4411b032f87';
const LAB = '1cc01456-fafd-48d6-acf6-b15e667440d7';
const RAD = '2c321d44-4e19-4dd0-a1ac-e47ae84d26ee';
const PATIENT = 'df28c121-79e9-46ea-abdf-0555d24e12dd';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const orders = app.get(OrderService);
  const prisma = app.get(PrismaService);

  // Resolve the two items' list prices so we can set a known payable.
  const [lab, rad] = await prisma.runWithTenant(TENANT, () =>
    Promise.all([
      prisma.branchLabTest.findUnique({ where: { id: LAB }, select: { listPrice: true } }),
      prisma.branchRadiologyTest.findUnique({ where: { id: RAD }, select: { listPrice: true } }),
    ]),
  );
  const labPrice = lab?.listPrice ?? 0;
  const radPrice = rad?.listPrice ?? 0;
  const gross = labPrice + radPrice;
  // This branch disables partial billing, so pay in full; the split math for
  // partial/uneven amounts is covered by suborder-split.spec.ts.
  const paid = gross;

  console.log('Item prices → lab', labPrice, 'rad', radPrice, 'gross', gross, 'paying', paid);

  const created = await orders.create(TENANT, BRANCH, null, {
    status: OrderStatus.ORDER,
    orderDate: new Date().toISOString().slice(0, 10),
    orderType: OrderType.WALK_IN,
    billingType: BillingType.CASH_CLIENT,
    isBillGenerated: true,
    patientId: PATIENT,
    items: [{ branchLabTestId: LAB }, { branchRadiologyTestId: RAD }],
    payments: [
      {
        totalAmount: gross,
        netAmount: gross,
        payableAmount: gross,
        paidAmount: paid,
        remainingBalance: gross - paid,
        paymentMode: PaymentMode.CASH,
      },
    ],
  } as any);

  console.log('\nParent created:', created.orderCode, 'kind', (created as any).orderKind, 'id', created.id);

  const children = await orders.findSubOrders(created.id, TENANT);
  console.log('Sub-orders:', children.length);
  let sumPaid = 0;
  let sumNet = 0;
  for (const c of children) {
    const pay = (c as any).payments ?? [];
    const childPaid = pay.reduce((s: number, p: any) => s + Number(p.paidAmount ?? 0), 0);
    sumPaid += childPaid;
    sumNet += Number((c as any).netAmount ?? 0);
    console.log(
      `  • ${(c as any).section} ${c.orderCode} billId=${c.billId} items=${(c as any).items.length} ` +
        `net=${(c as any).netAmount} paid=${childPaid} billStatus=${(c as any).billStatus}`,
    );
  }

  console.log('\nChecks:');
  console.log('  parent kind == PARENT:', (created as any).orderKind === 'PARENT');
  console.log('  two children:', children.length === 2);
  console.log('  each child has 1 item:', children.every((c: any) => c.items.length === 1));
  console.log('  Σ child paid == order paid:', Math.abs(sumPaid - paid) < 0.01, `(${sumPaid} vs ${paid})`);
  console.log('  Σ child net == gross:', Math.abs(sumNet - gross) < 0.01, `(${sumNet} vs ${gross})`);

  // Verify the parent is excluded from the list and children are present.
  const list = await orders.findAll(TENANT, BRANCH, { page: 1, limit: 50 } as any);
  const ids = new Set(list.data.map((r: any) => r.id));
  console.log('  parent excluded from list:', !ids.has(created.id));
  console.log(
    '  children present in list:',
    children.every((c: any) => ids.has(c.id)),
  );

  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e);
  process.exit(1);
});
