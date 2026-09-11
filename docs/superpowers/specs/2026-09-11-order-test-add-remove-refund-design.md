# Safe test add/remove on order update — design spec

- **Date:** 2026-09-11
- **Status:** Approved (design)
- **Repos affected:** `kalnostics-new` (backend, primary), `kaltros-fe` (frontend)
- **Related memory:** invoice-locks-order-update-cancel, order-cancellation-refund-feature,
  order-refund-status, accession-module, order-payment-split-persistence

---

## 1. Problem

When a user updates an existing order (from `/registration/billings`,
`/finance/billings`, Patient Detail → Billings, or `/registration/appointments`)
and **adds or removes tests**, the backend does not keep the rest of the system
consistent. Verified against the current code:

- `OrderService.update()` soft-deletes **every** `OrderItem` and recreates the
  set from the DTO (`order.service.ts:5491`). Recreated rows get **new ids**, so
  every existing `OrderSample` (`OrderSampleTest.orderItemId`) and `LabReport`
  (`LabReport.orderItemId`) is left pointing at a now-deleted item — the
  linkage is orphaned even for **unchanged** tests.
- Sample generation is one-shot: `OrderSampleService.generateForOrderInTx`
  early-returns when the order already has any sample
  (`accession-sample.service.ts:182`). So an **added** test never gets a sample,
  and a **removed** test's sample is never voided — Accession keeps showing it as
  active.
- There is **no** deletion-eligibility guard (a test whose report is already
  filled can be silently removed), **no** refund handling on removal, and **no**
  recomputation of order/sample/bill status from the surviving tests.
- The overpayment guard (`order.service.ts:5211`,
  `PaymentOverpaymentException`) actively **throws** when the recomputed net
  drops below the amount already paid — which is exactly the paid-then-reduced
  case we need to support.

## 2. Goal / required behavior

When a test is added or removed during an order update:

1. **Deletion eligibility** — a test is removable only until its report has been
   filled/generated. Blocked once its `LabReport` reaches `SAVED` or beyond.
2. **Billing & refund** — after applying all adds/removes, recompute the order
   amount (remaining tests − order-level discount). If the already-paid amount
   exceeds the new amount, the surplus is a **pending refund** shown as a
   **negative billing balance**; it is **settled manually** via the existing
   refund action. Unpaid/underpaid orders generate no refund.
3. **Accession** — a removed test no longer appears as an active test; if an
   order had 3 tests and 1 is removed, Accession shows 2 active tests. A
   previously collected test must not remain active. Its sample records are
   voided per the data model.
4. **Status recalculation** — order status, sample status, and bill/payment
   status are recomputed from the **remaining active tests only**.

### Worked example (acceptance)

Order net ₹1,000, 3 tests, customer paid ₹1,000. Remove one test worth ₹300:

- Recomputed net = **₹700**.
- `effectivePaid` = ₹1,000.
- Billing balance = `net − effectivePaid` = `700 − 1000` = **−₹300** (refundable).
- Accession active samples: **3 → 2**.
- Action menu becomes **refund-only** (Make Payment hidden) until settled.

## 3. Non-goals

- Removing **all** tests from an order (fails `assertFinalizedOrder`,
  `itemCount > 0`) — treat as a cancellation, out of scope here.
- Auto-settling the refund. The negative balance is derived; the actual money-
  back is recorded by the existing manual refund action
  (`POST /orders/:id/refund`).
- Changing how order-level discount is entered — the update payload/FE supplies
  the new discount; the backend recomputes net from the submitted items +
  discount (it does not auto-prorate).
- Reworking the accession sample state machine beyond what voiding a removed
  sample requires.

---

## 4. Design

### 4.1 Item update by stable id (backend)

Replace the "soft-delete all + recreate" block in `OrderService.update()` with a
**reconcile keyed on `OrderItem.id`**:

- Add optional `id?: string` (`@IsUUID`) to `OrderItemDto`. The Update Order form
  already loads existing lines with their ids.
- Load existing live items (`where: { orderId, tenantId, deletedAt: null }`).
- Partition incoming items:
  - **KEEP** — incoming line has an `id` matching a live item → update only
    mutable fields (`unitPrice`, `discount`, `discountMode`, `discountValue`,
    `outsourceCenterId`); the row and its id stay stable.
  - **ADD** — incoming line has no `id` → insert a new `OrderItem`.
  - **REMOVE** — a live item's id is not present in the payload → soft-delete
    (`deletedAt = now`).
- Preserving ids for KEEP items fixes the current orphaning bug: their
  `OrderSample` / `LabReport` linkage remains valid.

**Validation:** a supplied `id` must belong to this order (else
`OrderItemNotFoundException`). Catalogue/price validation of ADD/KEEP lines
continues through the existing `assertItems` / `loadItemUnitPrices`.

### 4.2 Deletion eligibility guard (req #1)

The true gate is the test's **`LabReport` status**, not the sample status. For
every REMOVE item (and, for a removed panel line, every member test):

- Load its `LabReport`(s). If any is at **`SAVED` or beyond**
  (`SAVED`, `VALIDATION_PENDING`, `RESULT_DONE`, `APPROVED`, `PUBLISHED`) →
  throw a new **`TestNotDeletableAfterReportException`** (HTTP 422) naming the
  test. Removal is allowed while the report is absent / `PENDING` /
  `PARTIAL_PENDING`.
- **Decision (default, confirm before build):** `ERROR_REPORTED` and
  `RESULT_REJECTED` are treated as **blocked** (results had been entered).

Verified status flows (do not assume):
- `LabReportStatus`: `PENDING → PARTIAL_PENDING → SAVED → VALIDATION_PENDING →
  RESULT_DONE → APPROVED → PUBLISHED` (+ `ERROR_REPORTED`, `RESULT_REJECTED`).
  One `LabReport` **per member test** (`memberBranchLabTestId`).
- `SampleStatus` (accession): `NEW → COLLECTED → ACCEPTED → ACQUIRED → …`
  (+ HOLD/HALT/ERROR/REPEAT/STORED/DISCARDED/RETURNED/CANCELLED/transfers). The
  state machine's `cancel` action only runs from `NEW`/`COLLECTED`/`HOLD`, which
  is why an ACCEPTED/ACQUIRED sample must be voided directly (§4.3) rather than
  via `cancel`.

### 4.3 Sample reconcile (req #3) — new `reconcileForOrderInTx`

Add `OrderSampleService.reconcileForOrderInTx(tx, tenantId, branchId, personId,
orderId, { addedItemIds, removedItemIds })`, called from `update()` inside the
existing `withTenant` transaction. `generateForOrderInTx` stays for the
create/first-finalization path; the early-return guard is no longer the only
entry point.

- **ADD items** → generate their `OrderSample`s. Extract the existing per-item
  unit-building + create + barcode logic from `generateForOrderInTx` into a
  private helper both methods call, so added tests get samples + barcodes
  identically to first generation.
- **REMOVE items** → for each linked `OrderSample`:
  - If the sample is linked **only** to removed items → soft-delete it
    (`deletedAt = now`), set `status = CANCELLED`, and write an
    `OrderSampleStatusHistory` row (`action: 'cancel'`/void, `toStatus:
    CANCELLED`). It drops out of Accession's active list.
  - If the sample is **shared** with a surviving sibling test → keep the sample;
    soft-delete/remove only the removed test's `OrderSampleTest` link.
  - Also soft-delete the removed items' non-final `LabReport`s (they can only be
    `PENDING`/`PARTIAL_PENDING` given the §4.2 guard). *Verify `LabReport` has a
    `deletedAt`; if not, add one or hard-delete the pending report.*
- **KEEP items** → samples/reports untouched.

### 4.4 Billing & refund recompute (req #2)

Refund is **not** per-test; it is the delta from recomputing the whole order,
surfaced as a negative balance and settled manually.

- After the item reconcile, recompute order **net** from the final items +
  order-level discount as expressed by the update payload.
- Keep recorded **paid** as-is. Reuse `computeEffectivePaid(...)` and
  `derivePaymentStatus(newNet, paid)` (`order.entity.ts`).
- **Balance = `net − effectivePaid`.** When negative (e.g. −₹300) it is the
  refundable/owed-back amount. No refund `PaymentDetails` row is auto-created;
  `refundStatus` stays `NONE` until the manual refund action records the money
  returned (then `deriveRefundStatus` flips it).
- **Overpayment guard change (`order.service.ts:5211`):** allow a
  removal-driven surplus (`paid > net`) instead of throwing — it becomes the
  refundable balance. Still reject an attempt to **collect** more than owed
  (increasing `paid` beyond `net`). Precise rule: reject only when the incoming
  paid *increases* beyond net; permit when net dropped below existing paid.
- The removed `OrderItem` stays soft-deleted and **visible in bill/order
  history**, flagged as removed/refunded for audit.

### 4.5 Status recalculation (req #4)

Most of this falls out of the soft-deletes because existing derivations filter
`deletedAt: null`:

- `paymentStatus` → recomputed via `derivePaymentStatus(newNet, paid)`.
- Order report status, order sample status, Accession active count → recomputed
  over surviving items/samples.
- **Verify during planning** that each derivation
  (`deriveReportStatus`, the order `sampleStatus` derivation, the Accession
  active-count query) filters `deletedAt: null` on items **and** samples; fix
  any that do not.

### 4.6 Frontend (kaltros-fe)

- **Update Order form** (`Registration/Create` create-order form in edit mode):
  send `orderItemId` for kept lines; omit `id` for newly added lines; a removed
  line is simply absent from the payload.
- **Billings + finance/billings** (same `Registration/Billings` component,
  re-exported at `/finance/billings`; also Patient Detail → Billings tab):
  - Show the **negative balance** (owed back) wherever the bill balance renders.
  - Show the removed line flagged **Refund/Removed** in the order/bill history.
  - **Balance-aware action menu (`BillingActionsCell.tsx`):**
    - **Negative balance** → hide **Make Payment**, show **Refund** only (steer
      the user to settle the refund first).
    - **Positive balance** → show Make Payment (as today), Refund hidden/disabled.
    - **Zero balance** → neither.
    - Drive all three (menu, balance display, refund cap) off the single derived
      balance field so they always agree. Update Order stays subject to the
      existing invoice-lock/B2B rules.
  - Surface `TestNotDeletableAfterReportException` as a clear toast on Update
    Order save.

### 4.7 New / changed contracts

- `OrderItemDto`: `+ id?: string` (`@IsOptional @IsUUID`).
- New exception `TestNotDeletableAfterReportException` (422) in the order module
  `exceptions/`.
- `OrderSampleService`: `+ reconcileForOrderInTx(...)`, `+` extracted per-item
  sample-build helper.
- No new endpoint — behavior rides the existing `PATCH /orders/:id` and the
  existing `POST /orders/:id/refund` for manual settlement.
- Bruno docs updated for the changed order-update payload + the new error
  (mandatory per project rule).

---

## 5. Testing & verification

Backend integration test against the **real** update flow (per the
"verify the real flow, not just tsc" rule):

- 3-test order, remove 1 → Accession active samples 3 → 2; removed sample
  soft-deleted + `CANCELLED`; kept samples/reports still linked; net recomputed.
- Add a test on update → the added test gets an `OrderSample` + barcode.
- Remove a test whose report is `SAVED`+ → `TestNotDeletableAfterReportException`.
- Paid ₹1,000 order, remove ₹300 test → balance −₹300; action menu refund-only.
- Unpaid order, remove a test → no negative balance, still owes.
- Shared-sample case → sample survives, removed test's link dropped.

Then a **manual end-to-end run**: launch the app (PM2 dev harness), remove a
test via `/registration/billings`, confirm Accession count, negative balance,
and refund-only menu; settle the refund and confirm the balance clears.

## 6. Rollout / migration

- Schema: `OrderItemDto` is a DTO change (no migration). If `LabReport` needs a
  `deletedAt` for §4.3, ship a committed Prisma migration + RLS as required
  (per the "always create a Prisma migration" rule).
- No data backfill: existing orders are unaffected until next updated.

## 7. Open questions (confirm before/at implementation)

1. `ERROR_REPORTED` / `RESULT_REJECTED` → blocked (default) or deletable?
2. Does `LabReport` already have a soft-delete field, or do we add one / hard-
   delete pending reports on removal? (Resolve during planning.)
