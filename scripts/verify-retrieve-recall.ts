/**
 * Runtime verification of the accession Retrieve/recall fix (throwaway script).
 *
 * Creates an ISOLATED test tenant (+ 2 branches, 1 order, 2 samples), drives the
 * REAL accession/transfer services through the lifecycle, and asserts:
 *
 *   [A] History-based retrieve — New → Collected → Accepted, then
 *       Accepted → Collected → New → (skip, no previous status).
 *   [B] Cross-branch recall — Accepted → send(→Dest) → accept@Dest (clone made) →
 *       retrieve ⇒ origin sample back to Accepted, processingBranchId reset to the
 *       origin, the transfer soft-deleted (gone from the receiving branch's
 *       referral queue), and the destination clone soft-deleted.
 *
 * Everything it creates is deleted at the end. Run:
 *   ts-node --transpile-only -r tsconfig-paths/register scripts/verify-retrieve-recall.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderSampleService } from '../src/modules/accession/accession-sample.service';
import { SampleTransferService } from '../src/modules/accession/sample-transfer.service';

const PERSON: string | null = null;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const samples = app.get(OrderSampleService);
  const transfers = app.get(SampleTransferService);

  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: { name: `E2E Retrieve ${stamp}`, slug: `e2e-retrieve-${stamp}` },
  });
  const tenantId = tenant.id;
  console.log(`\nTest tenant: ${tenantId}`);

  const read = (id: string) =>
    prisma.withTenant(tenantId, (tx) =>
      tx.orderSample.findUnique({ where: { id } }),
    );
  const readTransfer = (id: string) =>
    prisma.withTenant(tenantId, (tx) =>
      tx.sampleTransfer.findUnique({ where: { id } }),
    );

  try {
    // ── Fixture ────────────────────────────────────────────────────────────
    const fixture = await prisma.withTenant(tenantId, async (tx) => {
      const branchA = await tx.branch.create({
        data: {
          tenantId,
          name: 'Origin A',
          branchType: 'DIAGNOSTIC',
          shortName: 'A',
          code: `BRA-${stamp}`,
        },
      });
      const branchB = await tx.branch.create({
        data: {
          tenantId,
          name: 'Dest B',
          branchType: 'DIAGNOSTIC',
          shortName: 'B',
          code: `BRB-${stamp}`,
        },
      });
      const patient = await tx.patient.create({
        data: {
          tenantId,
          firstName: 'E2E',
          mobile: `9${String(stamp).slice(-9)}`,
        },
      });
      const order = await tx.order.create({
        data: {
          tenantId,
          branchId: branchA.id,
          orderCode: `ORD-E2E-${stamp}`,
          orderDate: new Date(),
          orderType: 'WALK_IN',
          billingType: 'CASH_CLIENT',
          patientId: patient.id,
          status: 'ORDER',
        },
      });
      await tx.orderItem.create({
        data: { tenantId, branchId: branchA.id, orderId: order.id, direct: 'E2E Test' },
      });
      const mkSample = async (acc: string) => {
        const s = await tx.orderSample.create({
          data: {
            tenantId,
            branchId: branchA.id,
            orderId: order.id,
            labTestSampleId: `lts-${acc}`,
            accessionNo: acc,
            status: 'NEW',
            priority: 'ROUTINE',
            originBranchId: branchA.id,
            processingBranchId: branchA.id,
          },
        });
        // Birth row (fromStatus null) so retrieve correctly bottoms out at NEW.
        await tx.orderSampleStatusHistory.create({
          data: {
            tenantId,
            branchId: branchA.id,
            sampleId: s.id,
            action: 'generate',
            toStatus: 'NEW',
          },
        });
        return s;
      };
      return {
        branchA,
        branchB,
        sampleX: await mkSample(`ACC-E2E-X-${stamp}`),
        sampleY: await mkSample(`ACC-E2E-Y-${stamp}`),
      };
    });
    const { branchA, branchB, sampleX, sampleY } = fixture;

    // ── [A] History-based retrieve ───────────────────────────────────────────
    console.log('\n[A] History-based retrieve (New → Collected → Accepted):');
    await samples.collect([sampleX.id], tenantId, PERSON, { tubeType: 'EDTA' } as any);
    await samples.accept([sampleX.id], tenantId, PERSON, {
      sampleCondition: 'Satisfactory',
    } as any);
    check('accept → ACCEPTED', (await read(sampleX.id))?.status === 'ACCEPTED');

    await samples.retrieve([sampleX.id], tenantId, PERSON, { skipInvalid: true } as any);
    check('retrieve → COLLECTED', (await read(sampleX.id))?.status === 'COLLECTED',
      `got ${(await read(sampleX.id))?.status}`);

    await samples.retrieve([sampleX.id], tenantId, PERSON, { skipInvalid: true } as any);
    check('retrieve → NEW', (await read(sampleX.id))?.status === 'NEW',
      `got ${(await read(sampleX.id))?.status}`);

    await samples.retrieve([sampleX.id], tenantId, PERSON, { skipInvalid: true } as any);
    check('retrieve at NEW → skip (stays NEW)', (await read(sampleX.id))?.status === 'NEW',
      `got ${(await read(sampleX.id))?.status}`);

    // ── [B] Cross-branch recall ──────────────────────────────────────────────
    console.log('\n[B] Cross-branch recall (send → accept@dest → retrieve):');
    await samples.collect([sampleY.id], tenantId, PERSON, { tubeType: 'EDTA' } as any);
    await samples.accept([sampleY.id], tenantId, PERSON, {
      sampleCondition: 'Satisfactory',
    } as any);
    const sent = await transfers.send([sampleY.id], tenantId, PERSON, {
      destinationBranchId: branchB.id,
    } as any);
    const transfer = sent[0]!;
    check('send → SENT_INTERNAL', (await read(sampleY.id))?.status === 'SENT_INTERNAL');
    check('transfer created (IN_TRANSIT)', transfer?.transferStatus === 'IN_TRANSIT');

    await transfers.pickUp([transfer.id], tenantId, PERSON, {} as any);
    await transfers.receive([transfer.id], tenantId, PERSON, {
      receiveCondition: 'Good',
    } as any);
    await transfers.accept([transfer.id], tenantId, PERSON, {} as any);

    const tAccepted = await readTransfer(transfer.id);
    const cloneId = tAccepted?.clonedSampleId ?? null;
    check('transfer ACCEPTED + clone linked', tAccepted?.transferStatus === 'ACCEPTED' && !!cloneId,
      `status=${tAccepted?.transferStatus} clonedSampleId=${cloneId}`);
    const cloneBefore = cloneId ? await read(cloneId) : null;
    check('clone exists in dest branch (ACCEPTED, not deleted)',
      cloneBefore?.branchId === branchB.id && cloneBefore?.status === 'ACCEPTED' && cloneBefore?.deletedAt === null,
      `branch=${cloneBefore?.branchId} status=${cloneBefore?.status} deletedAt=${cloneBefore?.deletedAt}`);

    // Retrieve the origin sample.
    await samples.retrieve([sampleY.id], tenantId, PERSON, { skipInvalid: true } as any);
    const yAfter = await read(sampleY.id);
    check('origin sample back to ACCEPTED', yAfter?.status === 'ACCEPTED', `got ${yAfter?.status}`);
    check('processingBranchId reset to origin', yAfter?.processingBranchId === branchA.id,
      `got ${yAfter?.processingBranchId}`);

    const tAfter = await readTransfer(transfer.id);
    check('transfer soft-deleted', tAfter?.deletedAt != null, `deletedAt=${tAfter?.deletedAt}`);
    const cloneAfter = cloneId ? await read(cloneId) : null;
    check('clone soft-deleted', cloneAfter?.deletedAt != null, `deletedAt=${cloneAfter?.deletedAt}`);

    const queue = await transfers.findTransfers(tenantId, branchB.id, {
      direction: 'incoming',
      kind: 'INTERNAL',
    } as any);
    check('transfer gone from receiving branch referral queue',
      !queue.data.some((t: any) => t.id === transfer.id),
      `queue has ${queue.data.length} row(s)`);
  } catch (e) {
    failed++;
    console.error('\nUNEXPECTED ERROR:', e);
  } finally {
    // ── Cleanup (hard-delete the isolated test tenant's data) ────────────────
    try {
      await prisma.withTenant(tenantId, async (tx) => {
        await tx.labReport.deleteMany({ where: { tenantId } }).catch(() => undefined);
        await tx.sampleTransfer.deleteMany({ where: { tenantId } });
        await tx.orderSampleStatusHistory.deleteMany({ where: { tenantId } });
        await tx.orderSampleTest.deleteMany({ where: { tenantId } });
        await tx.orderSample.deleteMany({ where: { tenantId } });
        await tx.orderItem.deleteMany({ where: { tenantId } });
        await tx.order.deleteMany({ where: { tenantId } });
        await tx.patient.deleteMany({ where: { tenantId } });
        await tx.branch.deleteMany({ where: { tenantId } });
      });
      await prisma.tenant.delete({ where: { id: tenantId } });
      console.log('\nCleanup: test tenant removed.');
    } catch (e) {
      console.error('Cleanup failed (manual removal may be needed):', (e as Error).message);
    }
    console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
    await app.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
