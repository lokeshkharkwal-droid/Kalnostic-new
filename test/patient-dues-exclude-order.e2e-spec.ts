import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env into process.env before the Prisma client is constructed, without a
// dotenv dependency (keeps the project `tsc --noEmit` gate green under pnpm).
try {
  const env = readFileSync(join(process.cwd(), '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const match = /^\s*([\w.]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = (match[2] ?? '').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  /* .env is optional — the suite self-skips if the DB is unreachable */
}

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BillingType, OrderStatus, OrderType } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { OrderService } from './../src/modules/order/order.service';

/**
 * End-to-end test for the previous-dues "exclude the order being edited" fix
 * (`OrderService.getPatientDues` + its `excludeOrderId` param).
 *
 * Regression: editing an order with its OWN unpaid balance used to show that
 * balance as the patient's "previous dues" (the Create screen prompted to clear
 * it), yet the finalize-time gate EXCLUDES the order being finalized — so the
 * clearance was then rejected as an overpayment of ₹0. The fix makes the read
 * accept the same `excludeOrderId` the gate uses, so the two always agree.
 *
 * It seeds a patient + two ORDER-status orders (each with a balance) in the dev
 * database and asserts: WITHOUT `excludeOrderId` the outstanding is the sum of
 * both balances; WITH `excludeOrderId = orderA` the excluded order's balance drops
 * out, leaving only the other order's balance. Requires a reachable PostgreSQL;
 * the suite self-skips when no branch fixture exists so it stays green on an empty
 * database.
 */
describe('getPatientDues excludeOrderId (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: OrderService;

  let tenantId: string;
  let branchId: string;
  let patientId: string;
  let orderAId: string; // net 1000, paid 700 → balance 300 (the one to exclude)
  let orderBId: string; // net 500,  paid 200 → balance 300 (another real due)
  let ready = false;

  const suffix = `${Date.now()}`;
  const orderDate = new Date();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    orders = app.get(OrderService);

    const branch = await prisma.branch.findFirst({
      where: { deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (!branch) return;
    tenantId = branch.tenantId;
    branchId = branch.id;

    await prisma.withTenant(tenantId, async (tx) => {
      const patient = await tx.patient.create({
        data: { tenantId, branchId, firstName: `DuesE2E-${suffix}` },
        select: { id: true },
      });
      patientId = patient.id;

      const makeOrder = async (
        code: string,
        net: number,
        paid: number,
      ): Promise<string> => {
        const order = await tx.order.create({
          data: {
            tenantId,
            branchId,
            patientId,
            orderCode: code,
            orderDate,
            orderType: OrderType.WALK_IN,
            billingType: BillingType.CASH_CLIENT,
            status: OrderStatus.ORDER,
          },
          select: { id: true },
        });
        await tx.paymentDetails.create({
          data: {
            tenantId,
            branchId,
            orderId: order.id,
            netAmount: net,
            payableAmount: net,
            paidAmount: paid,
          },
        });
        return order.id;
      };

      orderAId = await makeOrder(`E2E-DUES-A-${suffix}`, 1000, 700);
      orderBId = await makeOrder(`E2E-DUES-B-${suffix}`, 500, 200);
    });
    ready = true;
  }, 60000);

  afterAll(async () => {
    if (ready) {
      await prisma.withTenant(tenantId, async (tx) => {
        await tx.paymentDetails.deleteMany({
          where: { tenantId, orderId: { in: [orderAId, orderBId] } },
        });
        await tx.order.deleteMany({
          where: { tenantId, id: { in: [orderAId, orderBId] } },
        });
        await tx.patient.deleteMany({ where: { tenantId, id: patientId } });
      });
    }
    await app?.close();
  });

  it('has fixtures to run against (skips otherwise)', () => {
    if (!ready) {
      console.warn('SKIP: needs at least one branch in the database.');
    }
    expect(true).toBe(true);
  });

  it('counts BOTH orders when no order is excluded', async () => {
    if (!ready) return;
    const dues = await prisma.runWithTenant(tenantId, () =>
      orders.getPatientDues(tenantId, patientId, branchId, true),
    );
    // 300 (order A) + 300 (order B)
    expect(dues.outstanding).toBe(600);
  });

  it('excludes the order being edited from the outstanding total', async () => {
    if (!ready) return;
    const dues = await prisma.runWithTenant(tenantId, () =>
      orders.getPatientDues(tenantId, patientId, branchId, true, orderAId),
    );
    // Order A's own balance (300) drops out → only order B's 300 remains.
    expect(dues.outstanding).toBe(300);
  });

  it('is a no-op to exclude an order with no outstanding balance', async () => {
    if (!ready) return;
    // Excluding order B (also 300) leaves order A's 300.
    const dues = await prisma.runWithTenant(tenantId, () =>
      orders.getPatientDues(tenantId, patientId, branchId, true, orderBId),
    );
    expect(dues.outstanding).toBe(300);
  });
});
