# Safe Test Add/Remove on Order Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user adds/removes tests during an order update, keep Accession samples, reports, billing balance, and all derived statuses consistent — with a report-status deletion guard and a manually-settled negative refund balance.

**Architecture:** Replace `OrderService.update()`'s destructive "delete-all-items + recreate" with a **diff by stable `OrderItem.id`** (keep/add/remove). Added tests generate samples; removed tests are report-gated then have their samples voided; the order net is recomputed so an over-paid order surfaces a **negative balance** (settled via the existing manual refund action). FE stops clamping balance at 0 and flips the action menu to refund-only when negative.

**Tech Stack:** NestJS, Prisma (Postgres + RLS), TypeScript strict, Jest (unit specs with mocked tx). FE: React + TanStack Query (kaltros-fe).

**Spec:** `docs/superpowers/specs/2026-09-11-order-test-add-remove-refund-design.md`

**Branch:** `feat/order-test-add-remove-refund` (already created).

---

## File Structure

**Backend (`kalnostics-new`)**
- Create: `src/modules/order/utils/order-item-diff.ts` — pure diff + guard + overpayment-rule helpers (unit-testable, no DB).
- Create: `src/modules/order/utils/order-item-diff.spec.ts` — unit tests for the pure helpers.
- Modify: `src/modules/order/dto/order-item.dto.ts` — add optional `id`.
- Modify: `src/modules/order/exceptions/order.exceptions.ts` — add `TestNotDeletableAfterReportException`.
- Modify: `src/modules/order/order.service.ts` — diff-based item update, deletion guard call, reconcile call, overpayment-guard relax (`update()`, ~5061-5690).
- Modify: `src/modules/accession/accession-sample.service.ts` — extract `buildSamplesForItems` helper; add `reconcileForOrderInTx`.
- Modify: `src/modules/accession/accession-sample.service.spec.ts` — add reconcile/void unit tests.
- Modify: `bruno/42 Orders/*.bru` — document the `id` field on update + the new error.

**Frontend (`kaltros-fe`)**
- Modify: `src/pages/Registration/Create/services/orders.api.ts` — add `id?` to `OrderItemDto`.
- Modify: `src/pages/Registration/Create/components/create-order/hooks/useCreateOrder.ts` — capture `catalogId → orderItemId` on load; attach `id` on payload build; surface the deletion-guard error.
- Modify: `src/pages/Registration/Billings/utils/mapBill.ts` — allow negative `balanceAmount` (remove the two `Math.max(0, …)` clamps).
- Modify: `src/pages/Registration/Billings/components/BillingActionsCell.tsx` — show Refund when `balanceAmount < 0` (Make Payment already auto-hides).

---

## Assumptions to confirm at start
- `ERROR_REPORTED` / `RESULT_REJECTED` are **blocked** for deletion (results had been entered). Encoded in `BLOCKING_REPORT_STATUSES` below — change that array if you decide otherwise.
- `LabReport` already has `deletedAt` (verified, `schema.prisma:7168`) — no migration needed.

---

## PHASE 1 — Backend pure logic (no DB)

### Task 1: Pure diff + guard + overpayment helpers

**Files:**
- Create: `src/modules/order/utils/order-item-diff.ts`
- Test: `src/modules/order/utils/order-item-diff.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/order/utils/order-item-diff.spec.ts
import { LabReportStatus } from '@prisma/client';
import {
  diffOrderItems,
  isTestDeletable,
  isDisallowedOverpayment,
  type IncomingOrderItem,
} from './order-item-diff';

describe('diffOrderItems', () => {
  it('classifies keep / add / remove by stable id', () => {
    const existing = ['a', 'b', 'c'];
    const incoming: IncomingOrderItem[] = [
      { id: 'a', branchLabTestId: 't1' }, // keep
      { id: 'b', branchLabTestId: 't2' }, // keep
      { branchLabTestId: 't9' },          // add (no id)
    ]; // 'c' absent -> remove
    const diff = diffOrderItems(existing, incoming);
    expect(diff.keep.map((k) => k.id).sort()).toEqual(['a', 'b']);
    expect(diff.add).toHaveLength(1);
    expect(diff.add[0]!.branchLabTestId).toBe('t9');
    expect(diff.removeIds).toEqual(['c']);
  });

  it('ignores an incoming id that is not an existing live item (treats as add)', () => {
    const diff = diffOrderItems(['a'], [{ id: 'ghost', branchLabTestId: 't1' }]);
    expect(diff.keep).toHaveLength(0);
    expect(diff.add).toHaveLength(1);
    expect(diff.removeIds).toEqual(['a']);
  });
});

describe('isTestDeletable', () => {
  it('allows removal when no report or only pending reports', () => {
    expect(isTestDeletable([])).toBe(true);
    expect(isTestDeletable([LabReportStatus.PENDING, LabReportStatus.PARTIAL_PENDING])).toBe(true);
  });
  it('blocks removal once any report is SAVED or beyond', () => {
    expect(isTestDeletable([LabReportStatus.PENDING, LabReportStatus.SAVED])).toBe(false);
    expect(isTestDeletable([LabReportStatus.APPROVED])).toBe(false);
    expect(isTestDeletable([LabReportStatus.RESULT_REJECTED])).toBe(false);
  });
});

describe('isDisallowedOverpayment', () => {
  it('permits a removal-driven surplus (paid unchanged, net dropped)', () => {
    // paid 1000, new net 700, previously paid 1000 -> surplus is refundable, allowed
    expect(isDisallowedOverpayment(1000, 700, 1000)).toBe(false);
  });
  it('rejects collecting MORE than owed (paid increased beyond net)', () => {
    expect(isDisallowedOverpayment(1200, 700, 1000)).toBe(true);
  });
  it('permits a normal fully-covered payment', () => {
    expect(isDisallowedOverpayment(700, 700, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kalnostics-new && pnpm test -- order-item-diff`
Expected: FAIL — `Cannot find module './order-item-diff'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/order/utils/order-item-diff.ts
import { LabReportStatus } from '@prisma/client';

/** Minimal shape of an incoming order-item line on update (subset of OrderItemDto). */
export interface IncomingOrderItem {
  id?: string;
  branchLabTestId?: string;
  branchLabPanelId?: string;
  direct?: string;
  [key: string]: unknown;
}

/** The keep/add/remove partition of an update's items against the stored set. */
export interface OrderItemDiff {
  keep: Array<{ id: string; incoming: IncomingOrderItem }>;
  add: IncomingOrderItem[];
  removeIds: string[];
}

/**
 * Partition incoming update items against the order's existing live item ids,
 * keyed on stable `OrderItem.id`.
 * - keep: incoming line whose `id` matches a live item (fields may have changed).
 * - add: incoming line with no `id`, or an `id` that is not a live item.
 * - removeIds: live item ids absent from the incoming payload.
 * @param existingIds live (deletedAt null) OrderItem ids for the order
 * @param incoming the update DTO's items
 */
export function diffOrderItems(
  existingIds: string[],
  incoming: IncomingOrderItem[],
): OrderItemDiff {
  const existing = new Set(existingIds);
  const keptIds = new Set<string>();
  const keep: OrderItemDiff['keep'] = [];
  const add: IncomingOrderItem[] = [];
  for (const item of incoming) {
    if (item.id && existing.has(item.id)) {
      keep.push({ id: item.id, incoming: item });
      keptIds.add(item.id);
    } else {
      add.push(item);
    }
  }
  const removeIds = existingIds.filter((id) => !keptIds.has(id));
  return { keep, add, removeIds };
}

/**
 * Report statuses at which a test can no longer be removed from an order — the
 * result has been filled/generated. Deletable only while a test has no report or
 * its reports are still PENDING / PARTIAL_PENDING.
 */
export const BLOCKING_REPORT_STATUSES: readonly LabReportStatus[] = [
  LabReportStatus.SAVED,
  LabReportStatus.VALIDATION_PENDING,
  LabReportStatus.RESULT_DONE,
  LabReportStatus.APPROVED,
  LabReportStatus.PUBLISHED,
  LabReportStatus.ERROR_REPORTED,
  LabReportStatus.RESULT_REJECTED,
];

/**
 * Whether a test (with the given report statuses across its LabReports) may still
 * be removed. True when none of its reports has reached a blocking status.
 * @param reportStatuses the statuses of every LabReport for the test being removed
 */
export function isTestDeletable(reportStatuses: LabReportStatus[]): boolean {
  return !reportStatuses.some((s) => BLOCKING_REPORT_STATUSES.includes(s));
}

/**
 * Whether an update's payment ledger is a disallowed overpayment. A surplus that
 * results from the order's net dropping below what was already paid (e.g. a paid
 * test removed) is allowed — it becomes a refundable negative balance. Only
 * COLLECTING more than owed (paid increased beyond both net and the prior paid)
 * is rejected.
 * @param payPaid summed paidAmount on the incoming ledger
 * @param payNet summed netAmount on the incoming ledger (new order value)
 * @param storedPaid summed paidAmount already recorded on the order before update
 */
export function isDisallowedOverpayment(
  payPaid: number,
  payNet: number,
  storedPaid: number,
): boolean {
  return payPaid > payNet && payPaid > storedPaid;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kalnostics-new && pnpm test -- order-item-diff`
Expected: PASS (3 suites).

- [ ] **Step 5: Commit**

```bash
git add src/modules/order/utils/order-item-diff.ts src/modules/order/utils/order-item-diff.spec.ts
git commit -m "feat(order): pure item-diff, deletion-guard, overpayment helpers"
```

---

### Task 2: DTO field + new exception

**Files:**
- Modify: `src/modules/order/dto/order-item.dto.ts`
- Modify: `src/modules/order/exceptions/order.exceptions.ts`

- [ ] **Step 1: Add `id` to `OrderItemDto`**

In `order-item.dto.ts`, immediately inside the class (before `branchLabTestId`), add:

```ts
  /**
   * The existing OrderItem id on an update — present for a line that already
   * exists on the order (kept), omitted for a newly added line. On create it is
   * always omitted. Used by `OrderService.update` to diff keep/add/remove.
   */
  @IsOptional()
  @IsUUID()
  id?: string;
```

- [ ] **Step 2: Add the exception**

At the end of `order.exceptions.ts`, add:

```ts
/**
 * 422 — a test cannot be removed from an order because its report has already
 * been filled/generated (LabReport at SAVED or beyond). `testName` is the
 * offending line for the client message; `orderItemId` is logged in context.
 */
export class TestNotDeletableAfterReportException extends KaltrosException {
  constructor(orderItemId: string, testName: string | null) {
    super(
      'TEST_NOT_DELETABLE_AFTER_REPORT',
      `The test "${testName ?? 'selected test'}" cannot be removed because its report is already filled or generated`,
      { orderItemId, testName },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
```

- [ ] **Step 3: Type-check**

Run: `cd kalnostics-new && pnpm type-check`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/modules/order/dto/order-item.dto.ts src/modules/order/exceptions/order.exceptions.ts
git commit -m "feat(order): add OrderItem id to DTO + TestNotDeletableAfterReport exception"
```

---

## PHASE 2 — Accession sample reconcile

### Task 3: Extract per-item sample builder

**Files:**
- Modify: `src/modules/accession/accession-sample.service.ts` (`generateForOrderInTx`, ~172-279)

Goal: pull the per-item → sample-units → create + barcode logic into a private
helper so both first-generation and reconcile use one code path. **No behavior
change** in this task.

- [ ] **Step 1: Add the helper**

Add this private method to `OrderSampleService` (place it right after `generateForOrderInTx`). It contains the exact body currently inside `generateForOrderInTx` from the `const units: SampleUnit[] = [];` line through the `assignBarcodesToGroups(...)` call:

```ts
  /**
   * Build + persist the OrderSample rows (with tests link, NEW history, and
   * grouping-aware barcodes) for a specific set of the order's items, inside an
   * existing tenant-scoped transaction. Shared by first-time generation
   * ({@link generateForOrderInTx}) and update reconcile
   * ({@link reconcileForOrderInTx}).
   * @param items the order items (with branchLabTest/branchLabPanel included) to expand
   */
  private async buildSamplesForItems(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    orderId: string,
    items: Array<
      Prisma.OrderItemGetPayload<{
        include: { branchLabTest: true; branchLabPanel: true };
      }>
    >,
  ): Promise<void> {
    const units: SampleUnit[] = [];
    for (const item of items) {
      if (item.branchLabTest) {
        await this.collectTestUnits(tx, tenantId, item.id, item.branchLabTest, units);
      } else if (item.branchLabPanel) {
        const tests = await this.panelConstituentTests(tx, tenantId, item.branchLabPanel.id);
        for (const test of tests) {
          await this.collectTestUnits(tx, tenantId, item.id, test, units);
        }
      }
    }

    const createdSamples: BarcodeGroupable[] = [];
    for (const unit of units) {
      if (!unit.sample) continue;
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: { accessionCounter: { increment: 1 } },
        select: { accessionCounter: true },
      });
      const accessionNo = `ACC-${String(tenant.accessionCounter).padStart(5, '0')}`;
      const created = await tx.orderSample.create({
        select: { id: true, departmentId: true, sampleGroupLabel: true },
        data: {
          tenantId,
          branchId,
          orderId,
          labTestId: unit.labTestId,
          labTestSampleId: unit.sample.id,
          departmentId: unit.departmentId,
          accessionNo,
          sampleType: unit.sample.sampleType,
          containerType: unit.sample.containerType,
          sampleGroupLabel:
            unit.sample.sampleName ?? unit.sample.sampleType ?? unit.sample.containerType ?? 'General',
          status: SampleStatus.NEW,
          originBranchId: branchId,
          processingBranchId: branchId,
          createdBy: personId,
          updatedBy: personId,
          tests: {
            create: {
              tenantId,
              branchId,
              orderItemId: unit.orderItemId,
              labTestId: unit.labTestId,
              testName: unit.testName,
            },
          },
          statusHistory: {
            create: { tenantId, branchId, action: 'generate', toStatus: SampleStatus.NEW, changedBy: personId },
          },
        },
      });
      createdSamples.push(created);
    }
    await this.assignBarcodesToGroups(tx, tenantId, branchId, personId, createdSamples);
  }
```

- [ ] **Step 2: Make `generateForOrderInTx` delegate to it**

Replace the body of `generateForOrderInTx` from `const items = await tx.orderItem.findMany(...)` to the end of the method with:

```ts
    const items = await tx.orderItem.findMany({
      where: { orderId, tenantId, deletedAt: null },
      include: { branchLabTest: true, branchLabPanel: true },
    });
    if (items.length === 0) return;
    await this.buildSamplesForItems(tx, tenantId, branchId, personId, orderId, items);
```

Keep the leading idempotency guard (`const existing = await tx.orderSample.count(...); if (existing > 0) return;`) unchanged.

- [ ] **Step 3: Run existing accession specs**

Run: `cd kalnostics-new && pnpm test -- accession-sample.service`
Expected: PASS (existing panel-resolution specs still green — refactor is behavior-preserving).

- [ ] **Step 4: Type-check + commit**

Run: `cd kalnostics-new && pnpm type-check` → PASS.

```bash
git add src/modules/accession/accession-sample.service.ts
git commit -m "refactor(accession): extract buildSamplesForItems from generateForOrderInTx"
```

---

### Task 4: `reconcileForOrderInTx` (add → generate, remove → void)

**Files:**
- Modify: `src/modules/accession/accession-sample.service.ts`
- Test: `src/modules/accession/accession-sample.service.spec.ts`

- [ ] **Step 1: Write the failing test (mocked tx, following the existing spec pattern)**

Append to `accession-sample.service.spec.ts` a new describe block. It drives the **remove** path: a sample linked only to a removed item is voided; a sample shared with a surviving item keeps the sample and only drops the removed test's link.

```ts
describe('OrderSampleService — reconcileForOrderInTx (remove path)', () => {
  function makeService() {
    return new OrderSampleService(
      {} as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
    );
  }

  it('voids a sample linked only to removed items and drops shared links', async () => {
    const now = new Date('2026-09-11T00:00:00Z');
    // sample S1 -> only removed item R1 ; sample S2 -> removed R1 + surviving K1
    const tx = {
      orderSample: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'S1', tests: [{ id: 'l1', orderItemId: 'R1', deletedAt: null }] },
          {
            id: 'S2',
            tests: [
              { id: 'l2', orderItemId: 'R1', deletedAt: null },
              { id: 'l3', orderItemId: 'K1', deletedAt: null },
            ],
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      orderSampleTest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      labReport: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) }, // no adds
    } as unknown as import('@prisma/client').Prisma.TransactionClient;

    const service = makeService();
    await (service as unknown as {
      reconcileForOrderInTx: (
        tx: unknown, t: string, b: string | null, p: string | null, o: string,
        opts: { addedItemIds: string[]; removedItemIds: string[]; now: Date },
      ) => Promise<void>;
    }).reconcileForOrderInTx(tx, 'ten1', 'br1', 'per1', 'ord1', {
      addedItemIds: [],
      removedItemIds: ['R1'],
      now,
    });

    // S1 is exclusive to R1 -> soft-deleted + CANCELLED
    expect((tx.orderSample.update as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'S1' },
        data: expect.objectContaining({ deletedAt: now, status: 'CANCELLED' }),
      }),
    );
    // S2 is shared -> NOT voided; only R1's link (l2) dropped
    expect((tx.orderSample.update as jest.Mock)).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'S2' } }),
    );
    expect((tx.orderSampleTest.updateMany as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['l2'] } }),
        data: expect.objectContaining({ deletedAt: now }),
      }),
    );
    // pending reports of removed items soft-deleted
    expect((tx.labReport.updateMany as jest.Mock)).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kalnostics-new && pnpm test -- accession-sample.service`
Expected: FAIL — `reconcileForOrderInTx is not a function`.

- [ ] **Step 3: Implement `reconcileForOrderInTx`**

Add this public method after `buildSamplesForItems`:

```ts
  /**
   * Reconcile an order's accession samples with an item-set change made during an
   * order update, inside an existing tenant-scoped transaction. Added items get
   * fresh samples; removed items have their exclusively-linked samples voided
   * (soft-deleted + CANCELLED) while samples shared with a surviving test keep the
   * sample and drop only the removed test's OrderSampleTest link; the removed
   * items' non-final LabReports are soft-deleted. Kept items are untouched.
   * @param opts.addedItemIds newly created OrderItem ids on this update
   * @param opts.removedItemIds OrderItem ids soft-deleted on this update
   * @param opts.now the update transaction timestamp (single source of truth)
   */
  async reconcileForOrderInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    orderId: string,
    opts: { addedItemIds: string[]; removedItemIds: string[]; now: Date },
  ): Promise<void> {
    const { addedItemIds, removedItemIds, now } = opts;

    if (removedItemIds.length > 0) {
      const removedSet = new Set(removedItemIds);
      const samples = await tx.orderSample.findMany({
        where: { orderId, tenantId, deletedAt: null, tests: { some: { orderItemId: { in: removedItemIds }, deletedAt: null } } },
        select: { id: true, tests: { where: { deletedAt: null }, select: { id: true, orderItemId: true } } },
      });
      for (const sample of samples) {
        const links = sample.tests;
        const removedLinks = links.filter((l) => removedSet.has(l.orderItemId));
        const survivingLinks = links.filter((l) => !removedSet.has(l.orderItemId));
        if (survivingLinks.length === 0) {
          // Sample belongs entirely to removed tests -> void it.
          await tx.orderSample.update({
            where: { id: sample.id },
            data: {
              deletedAt: now,
              status: SampleStatus.CANCELLED,
              updatedBy: personId,
              statusHistory: {
                create: { tenantId, branchId, action: 'cancel', toStatus: SampleStatus.CANCELLED, changedBy: personId, reason: 'Test removed from order' },
              },
            },
          });
        } else {
          // Shared sample survives; drop only the removed tests' links.
          await tx.orderSampleTest.updateMany({
            where: { id: { in: removedLinks.map((l) => l.id) } },
            data: { deletedAt: now },
          });
        }
      }
      // Soft-delete the removed items' reports (guard guarantees none is SAVED+).
      await tx.labReport.updateMany({
        where: { orderItemId: { in: removedItemIds }, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
    }

    if (addedItemIds.length > 0) {
      const items = await tx.orderItem.findMany({
        where: { id: { in: addedItemIds }, orderId, tenantId, deletedAt: null },
        include: { branchLabTest: true, branchLabPanel: true },
      });
      if (items.length > 0) {
        await this.buildSamplesForItems(tx, tenantId, branchId, personId, orderId, items);
      }
    }
  }
```

> Note: if `OrderSampleStatusHistory.create` has no `reason` field, drop the `reason` key (check the model). If `OrderSampleTest` has no `deletedAt`, use `tx.orderSampleTest.deleteMany` instead of `updateMany`+`deletedAt` — verify in `schema.prisma` (`grep -n "model OrderSampleTest" prisma/schema.prisma`) before implementing and adjust the test accordingly.

- [ ] **Step 4: Verify `OrderSampleTest` / history fields before running**

Run: `cd kalnostics-new && grep -nA15 "model OrderSampleTest" prisma/schema.prisma && grep -nA12 "model OrderSampleStatusHistory" prisma/schema.prisma`
Expected: confirms whether `OrderSampleTest.deletedAt` and `OrderSampleStatusHistory.reason` exist. Adjust the implementation + test to match (soft-delete vs hard-delete link; keep/drop `reason`).

- [ ] **Step 5: Run tests to verify pass**

Run: `cd kalnostics-new && pnpm test -- accession-sample.service`
Expected: PASS.

- [ ] **Step 6: Type-check + commit**

Run: `pnpm type-check` → PASS.

```bash
git add src/modules/accession/accession-sample.service.ts src/modules/accession/accession-sample.service.spec.ts
git commit -m "feat(accession): reconcileForOrderInTx voids removed-test samples, generates added"
```

---

## PHASE 3 — Wire reconcile + guard + refund into update()

### Task 5: Diff-based item update + deletion guard + reconcile + overpayment relax

**Files:**
- Modify: `src/modules/order/order.service.ts` (`update()`, ~5061-5690)

This task threads the diff through `update()`. Do it in the order below.

- [ ] **Step 1: Import the helpers**

At the top of `order.service.ts`, add to the existing order-module imports:

```ts
import {
  diffOrderItems,
  isTestDeletable,
  isDisallowedOverpayment,
  type IncomingOrderItem,
} from './utils/order-item-diff';
import { TestNotDeletableAfterReportException } from './exceptions/order.exceptions';
```

Also confirm `OrderSampleService` is injected (it is — `this.orderSamples`).

- [ ] **Step 2: Relax the overpayment guard**

Replace the existing overpayment check (currently at ~5211):

```ts
    if (dto.payments !== undefined && payPaid > payNet) {
      throw new PaymentOverpaymentException(payNet, payPaid);
    }
```

with a version that permits a removal-driven surplus. Add a `storedPaid` read just above it (reuse the pattern already used later in the method):

```ts
    const storedPaidAgg =
      dto.payments !== undefined
        ? await this.prisma.paymentDetails.aggregate({
            where: { orderId: id, tenantId, deletedAt: null },
            _sum: { paidAmount: true },
          })
        : null;
    const storedPaidTotal = roundToTwoDecimalPlaces(toNum(storedPaidAgg?._sum.paidAmount));
    if (
      dto.payments !== undefined &&
      isDisallowedOverpayment(payPaid, payNet, storedPaidTotal)
    ) {
      throw new PaymentOverpaymentException(payNet, payPaid);
    }
```

- [ ] **Step 3: Compute the diff + run the deletion guard, before the item write**

Replace the item block (currently `if (dto.items !== undefined) { await tx.orderItem.updateMany({... deletedAt ...}); if (dto.items.length) { ... createMany ... } }` at ~5491-5522) with a diff-driven version. First, just above the `withTenant` transaction (near the other pre-tx reads, ~5384), compute the diff and guard:

```ts
    // Item diff (keep/add/remove) + deletion-eligibility guard — only when the
    // patch replaces items. Uses stable OrderItem ids sent by the FE.
    let itemDiff: ReturnType<typeof diffOrderItems> | null = null;
    if (dto.items !== undefined) {
      const liveItems = await this.prisma.orderItem.findMany({
        where: { orderId: id, tenantId, deletedAt: null },
        select: { id: true },
      });
      itemDiff = diffOrderItems(
        liveItems.map((i) => i.id),
        dto.items as IncomingOrderItem[],
      );
      // Guard: a removed item whose report is filled/generated cannot be deleted.
      if (itemDiff.removeIds.length > 0) {
        const reports = await this.prisma.labReport.findMany({
          where: { orderItemId: { in: itemDiff.removeIds }, tenantId, deletedAt: null },
          select: { orderItemId: true, status: true },
        });
        const byItem = new Map<string, import('@prisma/client').LabReportStatus[]>();
        for (const r of reports) {
          const list = byItem.get(r.orderItemId) ?? [];
          list.push(r.status);
          byItem.set(r.orderItemId, list);
        }
        for (const removedId of itemDiff.removeIds) {
          if (!isTestDeletable(byItem.get(removedId) ?? [])) {
            const li = await this.prisma.orderItem.findFirst({
              where: { id: removedId, tenantId },
              select: { branchLabTest: { select: { testName: true } }, branchLabPanel: { select: { panelName: true } }, direct: true },
            });
            const name = li?.branchLabTest?.testName ?? li?.branchLabPanel?.panelName ?? li?.direct ?? null;
            throw new TestNotDeletableAfterReportException(removedId, name);
          }
        }
      }
    }
```

- [ ] **Step 4: Apply the diff inside the transaction (replace delete-all+recreate)**

Inside the `withTenant` tx, replace the old item block with keep/add/remove writes and capture added ids:

```ts
      const addedItemIds: string[] = [];
      if (dto.items !== undefined && itemDiff) {
        // REMOVE
        if (itemDiff.removeIds.length > 0) {
          await tx.orderItem.updateMany({
            where: { id: { in: itemDiff.removeIds }, orderId: id, tenantId, deletedAt: null },
            data: { deletedAt: now, updatedBy: personId },
          });
        }
        // KEEP — update mutable fields only (prices re-resolved from catalogue)
        const keepPrices = await this.loadItemUnitPrices(
          tenantId,
          branchId,
          itemDiff.keep.map((k) => k.incoming as OrderItemDto),
        );
        for (const { id: itemId, incoming } of itemDiff.keep) {
          const i = incoming as OrderItemDto;
          await tx.orderItem.update({
            where: { id: itemId },
            data: {
              unitPrice: i.direct ? (i.unitPrice ?? 0) : (keepPrices.get(i.branchLabTestId ?? i.branchLabPanelId ?? '') ?? 0),
              discount: i.discount ?? 0,
              discountMode: i.discountMode ?? null,
              discountValue: i.discountValue ?? null,
              outsourceCenterId: i.outsourceCenterId ?? null,
              updatedBy: personId,
            },
          });
        }
        // ADD — create new rows, capturing their ids
        if (itemDiff.add.length > 0) {
          const addPrices = await this.loadItemUnitPrices(
            tenantId,
            branchId,
            itemDiff.add as OrderItemDto[],
          );
          for (const raw of itemDiff.add) {
            const i = raw as OrderItemDto;
            const created = await tx.orderItem.create({
              select: { id: true },
              data: {
                tenantId,
                branchId,
                orderId: id,
                branchLabTestId: i.branchLabTestId ?? null,
                branchLabPanelId: i.branchLabPanelId ?? null,
                direct: i.direct ?? null,
                unitPrice: i.direct ? (i.unitPrice ?? 0) : (addPrices.get(i.branchLabTestId ?? i.branchLabPanelId ?? '') ?? 0),
                discount: i.discount ?? 0,
                discountMode: i.discountMode ?? null,
                discountValue: i.discountValue ?? null,
                outsourceCenterId: i.outsourceCenterId ?? null,
              },
            });
            addedItemIds.push(created.id);
          }
        }
      }
```

- [ ] **Step 5: Replace the sample-generation call with the reconcile**

Where `update()` currently calls `generateForOrderInTx` (~5622-5631), branch on whether the order **already had samples**. Reconcile only applies to an order that was already accessioned; a first-time finalization generates the whole (final) item set:

```ts
      const hasDiagnostics = Boolean(dto.diagnostics ?? existing?.diagnostics);
      if (this.shouldGenerateSamples(effectiveStatus, hasDiagnostics)) {
        const alreadyAccessioned =
          (await tx.orderSample.count({ where: { orderId: id, tenantId, deletedAt: null } })) > 0;
        if (alreadyAccessioned && dto.items !== undefined && itemDiff) {
          // Order was already accessioned and its item set changed → reconcile the
          // delta (void removed tests' samples, generate the newly-added ones).
          await this.orderSamples.reconcileForOrderInTx(tx, tenantId, branchId, personId, id, {
            addedItemIds,
            removedItemIds: itemDiff.removeIds,
            now,
          });
        } else {
          // First-time generation for the whole (final) item set. Idempotent: it
          // early-returns if samples somehow already exist. On a first finalization
          // the "added" items are simply part of the order now, so generating the
          // whole order covers them — do NOT also reconcile (that would double-create).
          await this.orderSamples.generateForOrderInTx(tx, tenantId, branchId, personId, id);
        }
      }
```

> **Why not call both:** on a first finalization (`alreadyAccessioned === false`), `generateForOrderInTx` builds samples for every current item — including the just-added ones — so calling `reconcileForOrderInTx` afterwards would generate the added items' samples a second time. On an already-accessioned order, `generateForOrderInTx` would no-op anyway, so we skip straight to reconcile. The `alreadyAccessioned` count is read fresh inside the tx **before** any reconcile writes, so it reflects the pre-update state.

- [ ] **Step 6: Confirm `paymentStatus` recompute already covers the new net**

No new code — verify: the payment ledger is rebuilt from `dto.payments` (the FE sends the new net/paid), and `paymentStatus` is recomputed via `derivePaymentStatus(payNet, payPaid)` at ~5227. Read the block and confirm; the negative balance itself is derived on read/FE, not stored.

- [ ] **Step 7: Type-check**

Run: `cd kalnostics-new && pnpm type-check`
Expected: PASS. Fix any type mismatches (esp. `loadItemUnitPrices` signature, `OrderItemDto` import already present).

- [ ] **Step 8: Commit**

```bash
git add src/modules/order/order.service.ts
git commit -m "feat(order): diff-based item update with report guard, sample reconcile, refundable surplus"
```

---

### Task 6: Verify derived statuses exclude soft-deleted items/samples

**Files:** (read/verify; patch only if a filter is missing)
- `src/modules/order/order.service.ts` (order list `ORDER_LIST_INCLUDE`, `sampleStatus`/report-status derivation)
- `src/modules/accession/accession-sample.service.ts` / `accession-dashboard.service.ts` (active-sample list/count)

- [ ] **Step 1: Grep the derivations for `deletedAt` on items/samples**

Run:
```
cd kalnostics-new && grep -n "deriveReportStatus\|sampleStatus\|items: { where\|orderSample.findMany\|orderSample.count\|tests: { some" src/modules/order/order.service.ts src/modules/accession/accession-dashboard.service.ts | head -60
```
Expected: identify each place order items / order samples are counted or listed.

- [ ] **Step 2: Confirm each includes `deletedAt: null`**

For every item-relation include feeding a status derivation and every `orderSample` query feeding the Accession active list/count, confirm the `where` filters `deletedAt: null`. The accession spec's own doc comment states these "guard the query filters (deletedAt)", so most already do.

- [ ] **Step 3: Patch any missing filter**

If a query is missing `deletedAt: null` on items or samples, add it (e.g. `items: { where: { deletedAt: null } }`, `where: { ..., deletedAt: null }`). If none are missing, no change — note it in the commit message of the next task.

- [ ] **Step 4: Commit (only if a patch was needed)**

```bash
git add -A && git commit -m "fix(order): exclude soft-deleted items/samples from status derivations"
```

---

### Task 7: Bruno API docs

**Files:**
- Modify: `bruno/42 Orders/Update Order.bru` (or the update request file), and add a note/example for the new error.

- [ ] **Step 1: Update the update-order request body doc**

Add `id` to each item in the example body's `items[]` with a comment that it is sent for existing lines and omitted for new ones. Document the `TEST_NOT_DELETABLE_AFTER_REPORT` (422) error in the request's docs/notes.

- [ ] **Step 2: Commit**

```bash
git add "bruno/42 Orders/"
git commit -m "docs(bruno): document OrderItem id + TEST_NOT_DELETABLE_AFTER_REPORT on order update"
```

---

## PHASE 4 — Frontend (kaltros-fe)

> Run FE commands from `kaltros-fe`. Type-check/lint per `kaltros-fe/CLAUDE.md`.

### Task 8: Allow negative billing balance

**Files:**
- Modify: `src/pages/Registration/Billings/utils/mapBill.ts` (lines ~125 and ~210)

- [ ] **Step 1: Remove the clamp (both mappers)**

Change both occurrences of:

```ts
    balanceAmount: Math.max(0, net - paid),
```
to:
```ts
    balanceAmount: net - paid, // may be negative = refundable (owed back to customer)
```

- [ ] **Step 2: Type-check**

Run: `cd kaltros-fe && pnpm type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Registration/Billings/utils/mapBill.ts
git commit -m "feat(billings): surface negative (refundable) balance instead of clamping at 0"
```

---

### Task 9: Refund-only action menu on negative balance

**Files:**
- Modify: `src/pages/Registration/Billings/components/BillingActionsCell.tsx`

- [ ] **Step 1: Show Refund when balance is negative**

Make Payment already hides when `balanceAmount > 0` is false. Update the Refund item so a negative balance always surfaces it (subject to permission), and keep the existing settings/permission gate for the normal case. Change the Refund condition (currently `((settingsAllowRefund && canRefundPerm) || isB2b)`) to:

```tsx
            {((canRefundPerm && (settingsAllowRefund || row.balanceAmount < 0)) || isB2b) && (
```

- [ ] **Step 2: (Optional) hint text when refund is pending**

Where the balance renders in `ViewBillSheet` / the row balance cell, show a negative value styled as owed-back (e.g. red `-₹300`) with a "Refund pending" hint. Keep the change minimal — surface the negative number rather than a blank/zero.

- [ ] **Step 3: Type-check + manual check**

Run: `cd kaltros-fe && pnpm type-check` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Registration/Billings/components/BillingActionsCell.tsx
git commit -m "feat(billings): refund-only action menu when balance is negative"
```

---

### Task 10: Send stable OrderItem ids from the Update Order form

**Files:**
- Modify: `src/pages/Registration/Create/services/orders.api.ts` (`OrderItemDto`)
- Modify: `src/pages/Registration/Create/components/create-order/hooks/useCreateOrder.ts`

- [ ] **Step 1: Add `id` to the FE `OrderItemDto`**

In `orders.api.ts`, add to the `OrderItemDto` interface:

```ts
  /** Existing OrderItem id — sent for kept lines on update, omitted for new lines. */
  id?: string;
```

- [ ] **Step 2: Capture `catalogId → orderItemId` when loading an order for edit**

In `useCreateOrder.ts`, where the order's items are loaded into `labTests`/`labPanels` (~708-724), also build a ref map keyed by catalog id → existing OrderItem id. Add near the other edit-load state:

```ts
  const editItemIdByCatalogRef = useRef<Record<string, string>>({});
```

and while iterating the loaded `order.items`, populate it:

```ts
        const catalogId = i.branchLabTestId ?? i.branchLabPanelId;
        if (catalogId) editItemIdByCatalogRef.current[catalogId] = i.id;
```

(Confirm the loaded item shape exposes `i.id`; the order detail response includes item ids.)

- [ ] **Step 3: Attach `id` when building the items payload**

Where the payload items are built (~925-938), attach the id when the catalog line already existed:

```ts
      const existingId = editItemIdByCatalogRef.current[o.id];
      items.push({ ...(existingId ? { id: existingId } : {}), branchLabTestId: o.id, ...itemDiscount(o.id, o.price ?? 0) });
```
and the analogous panel push:
```ts
      const existingPanelId = editItemIdByCatalogRef.current[o.id];
      items.push({ ...(existingPanelId ? { id: existingPanelId } : {}), branchLabPanelId: o.id, ...itemDiscount(o.id, o.price ?? 0) });
```

New catalog lines have no map entry → no `id` → backend treats as ADD. Removed lines are simply absent → backend REMOVE.

- [ ] **Step 4: Type-check**

Run: `cd kaltros-fe && pnpm type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Registration/Create/services/orders.api.ts src/pages/Registration/Create/components/create-order/hooks/useCreateOrder.ts
git commit -m "feat(create-order): send stable OrderItem ids so update diffs keep/add/remove"
```

---

### Task 11: Surface the deletion-guard error

**Files:**
- Modify: `src/pages/Registration/Create/components/create-order/hooks/useCreateOrder.ts` (update mutation `onError`)

- [ ] **Step 1: Map the backend error code to a toast**

In the `updateOrderMut` error handler (~1152-1180), detect `TEST_NOT_DELETABLE_AFTER_REPORT` in the error envelope and show the server message (fallback to a friendly default) instead of a generic failure toast. Follow the existing toast/error pattern already used in this hook.

```ts
      onError: (err) => {
        const code = (err as { response?: { data?: { error?: { code?: string; message?: string } } } })?.response?.data?.error?.code;
        const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
        if (code === 'TEST_NOT_DELETABLE_AFTER_REPORT') {
          toast.error(msg ?? 'This test cannot be removed because its report is already filled or generated.');
          return;
        }
        // ...existing generic handling
      },
```

- [ ] **Step 2: Type-check + commit**

Run: `cd kaltros-fe && pnpm type-check` → PASS.

```bash
git add src/pages/Registration/Create/components/create-order/hooks/useCreateOrder.ts
git commit -m "feat(create-order): toast report-locked test removal error"
```

---

## PHASE 5 — End-to-end verification

### Task 12: Manual real-flow run (not just tsc)

- [ ] **Step 1: Start the dev harness**

Backend + FE via the PM2 dev harness (`deploy/ecosystem.dev.config.js`): backend :3000, kaltros-fe :3002. Ensure `prisma generate` ran if the client is stale.

- [ ] **Step 2: Acceptance scenario (the worked example)**

Create an order with 3 tests totalling ₹1,000, collect ₹1,000 (fully paid). Then via `/registration/billings` → Update Order, remove one ₹300 test and save. Verify:
- Order saves (no overpayment error).
- Accession (`/accession`) shows **2** active samples for the order (was 3); the removed test's sample is gone from the active list.
- Billings balance shows **−₹300**; the row action menu shows **Refund** and **no Make Payment**.
- Kept tests' samples/reports are intact (open the order in Accession/Reporting).

- [ ] **Step 3: Guard + add + unpaid scenarios**

- Fill/generate a report for one test, then try to remove that test on update → blocked with the report-locked toast.
- Add a new test on update → it appears as a new active sample in Accession with a barcode.
- On an **unpaid** order, remove a test → balance stays positive (still owes), no refund menu.

- [ ] **Step 4: Settle the refund**

From `/finance/billings`, open Refund on the −₹300 order, record ₹300 returned → balance clears to ₹0 and `refundStatus` reflects the refund.

- [ ] **Step 5: Final gate + push**

Run: `cd kalnostics-new && pnpm validate` (type-check + lint + format) → PASS.
Run: `cd kaltros-fe && pnpm type-check` → PASS.
Push the branch and open a PR when the user asks.

---

## Self-review notes
- **Spec coverage:** req#1 → Tasks 1(guard helper),2(exception),5(guard call); req#2 → Tasks 5(overpayment relax + net recompute),8,9; req#3 → Tasks 3,4,5(reconcile); req#4 → Tasks 5,6; FE action rule → Tasks 8,9; item-diff → Tasks 1,5,10; error UX → Task 11.
- **Open items intentionally deferred to implementation:** exact `OrderSampleTest`/`OrderSampleStatusHistory` field names (Task 4 Step 4), and confirming derivations already filter `deletedAt` (Task 6) — both are concrete verification steps, not placeholders.
