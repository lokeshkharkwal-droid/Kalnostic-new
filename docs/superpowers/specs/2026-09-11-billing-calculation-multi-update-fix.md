# Billing calculation correctness across multiple order updates — spec

- **Date:** 2026-09-11
- **Status:** Approved (design); server-authoritative approach chosen by user
- **Repos:** `kalnostics-new` (backend, primary), `kaltros-fe` (frontend)
- **Related:** invoice-locks-order-update-cancel, order-cancellation-refund-feature,
  order-refund-status, order-payment-split-persistence, the test add/remove feature
  (2026-09-11-order-test-add-remove-refund).

## 1. Problem (root cause — verified by code trace)

On `/registration/billings` and `/finance/billings`, the columns **Gross, Discount,
Net, Paid, Refund** (and Balance) are wrong after an order is updated multiple times
with different add/remove combinations. Traced causes:

1. **Payment/refund history is destroyed on every update.** `OrderService.update()`
   soft-deletes the **entire** `PaymentDetails` ledger with no `entryType` filter
   (`order.service.ts:5679`) and recreates it from only the FE's `PAYMENT` rows. The
   refund action writes a dedicated `entryType: REFUND` row (`order.service.ts:6090`),
   and the FE's `buildPaymentsDto` never re-sends refunds — so the REFUND row (and all
   prior payment history) is wiped on the next update. The billing rollups are
   `Σ` over that ledger (`order.service.ts:3346-3371`), so:
   - **Refund** → drops to ₹0.
   - **Paid** → inflates (`effectivePaid = paid − refunds`; the refunds term vanishes).
   - **Balance** → wrong (net − inflated paid).

2. **Gross/Net/Discount trust the latest FE payload, never re-derived from items.**
   The rollups read `Σ payments.totalAmount / netAmount / orderDiscount` — whatever the
   FE last sent. Combined with the FE **order-level % discount being frozen to a fixed
   AMOUNT on edit** (`useCreateOrder.ts:1831`), a % discount stops tracking the item
   total after add/remove, so **Discount** and **Net** drift. **Gross** likewise is
   never validated against the persisted items.

## 2. Goal

The five columns must always reflect the order's **current final item set** plus its
**complete payment/refund history**, regardless of how many add/remove updates
happened:

- **Gross, Discount, Net** — derived **server-side from the persisted items + charges +
  order-level discount**, so they cannot drift from the real order or the FE payload.
- **Paid, Refund** (and Balance) — computed from the **full, preserved** payment +
  refund transaction history, not just the latest update.

## 3. Authoritative billing formula (server-side, diagnostics)

For a diagnostics order (what the billing screens show), from persisted data:

- `gross`  = Σ active `OrderItem.unitPrice` + `sampleCollectionCharges` + `visitingCharges`
- `lineDiscount` = Σ active `OrderItem.discount`
- `orderDiscount` = from persisted (`orderDiscountMode`, `orderDiscountValue`):
  - `PERCENT` → `round2(value% × base)`
  - `AMOUNT`  → `min(value, base)`
  - **base** = the item total (`Σ unitPrice`), matching the FE's `orderDiscountBase`
    (VERIFY against `lines.orderDiscountBase` during implementation).
- `net`    = `gross − lineDiscount − orderDiscount`  (charges already in `gross`)
- **Discount column** = `gross − net` (= `lineDiscount + orderDiscount`) — a derived
  identity, so it is always the true total discount regardless of order/line split.

Charges come from `OrderDiagnostics` (`sampleCollectionCharges`, `visitingCharges`);
item prices are already server-resolved by `loadItemUnitPrices` on create/update.

## 4. Design

### 4.1 Preserve transaction history (Part 1 — fixes Paid, Refund, Balance)
- In `update()`, the ledger replace soft-deletes **only** `entryType = PAYMENT` rows.
  `REFUND` (and any future non-payment) rows are preserved.
- After rebuilding PAYMENT rows, recompute **both** `paymentStatus` and `refundStatus`
  (and the effective-paid-derived fields) from the **preserved** refund sum, reusing
  the same `computeEffectivePaid` / `deriveRefundStatus` helpers the refund/cancel
  paths use — so a refunded-then-edited order keeps its refunded status/balance.

### 4.2 Server-authoritative gross/net/discount (Part 2 — fixes Gross, Discount, Net)
- **Persist the order-level discount mode + value.** Add `orderDiscountMode`
  (`DiscountMode?`) and `orderDiscountValue` (`Decimal?`) to `PaymentDetails` (the
  billing-snapshot row) — one committed Prisma migration + RLS unchanged. Thread them
  through `OrderPaymentDto` so the FE sends them.
- **Server billing calculator.** A helper (extend `PricingService` or an
  `OrderService` private) that, given a persisted order id, returns
  `{ gross, lineDiscount, orderDiscount, net }` using §3.
- **Stamp on write.** In `create()` and `update()`, after items/charges/discount are
  persisted, compute the snapshot and write the authoritative `totalAmount` (=gross),
  `netAmount` (=net), `orderDiscount`, `netDiscount` (=lineDiscount+orderDiscount) onto
  the first PAYMENT row — **ignoring** the FE's own `totalAmount`/`netAmount` numbers.
- **Derive the Discount column.** Change the list serializer (and the detail mapper) so
  `discountAmount = gross − net` instead of `Σ orderDiscount`, so line discounts are
  always included and it can't drift.

### 4.3 Frontend
- `OrderPaymentDto`: send `orderDiscountMode` + `orderDiscountValue`.
- On edit hydration, restore the order-level discount **mode + value** from the order
  (not a frozen AMOUNT), so a % discount re-tracks the new item total — the FE display
  then matches the server-derived net. (`useCreateOrder.ts:1831`.)
- No change needed to `mapBill.ts` gross/net/paid (they already pass through the
  now-correct server rollups); Discount already reads `r.discountAmount` (now derived).

## 5. Non-goals
- OPD / Radiology / Procedure / Misc billing (the screens are diagnostics-only).
- Reworking the split-payment ledger model beyond preserving non-PAYMENT rows.
- Backfilling historical orders' discount mode/value (new/edited orders get it; old
  orders keep their stored amount — document the one-time gap).

## 6. Verification
- Backend unit tests for the billing calculator (gross/net/discount for %/amount/line
  discounts + charges) and for the update() ledger-preservation (REFUND row survives;
  status recomputed).
- Manual multi-update run: create 3-test paid order → add/remove across several updates,
  issue a refund, then edit again → confirm all six columns stay correct at each step on
  both billing screens.

## 6a. As-built (refinement discovered during implementation)

The codebase already had `orderLevelFigures()` (used by Finance reports + invoicing)
that folds line discounts into Discount and derives `gross = net + discount`. The
Billings list bypassed it with a cruder `Σ payments` rollup that omitted line
discounts — which was itself the Discount-column bug. So rather than a brand-new
"stamp on write" calculator, the fix centralised on a shared pure helper and reused
the existing figures function:

- **`src/modules/order/utils/billing-totals.ts` — `computeBillingTotals(payments, items)`**
  returns `{ gross, discount, net }`. It recomputes the order-level discount from the
  persisted `(orderDiscountMode, orderDiscountValue)` against the current item total,
  then **delta-corrects** the stored net: `net = ΣnetAmount + storedOrderDiscount −
  recomputed`. This corrects a frozen % without needing charges (they're already inside
  `Σ netAmount`). Legacy orders (null mode) → `recomputed = stored`, so behaviour is
  byte-identical to before (Finance reports unchanged).
- Both the **Billings list rollup** and **`orderLevelFigures`** call this one helper, so
  Billings and Finance are consistent by construction. `ORDER_LIST_INCLUDE.items` gained
  `unitPrice`/`discount` so the list can see line discounts.
- **Gross is unchanged for legacy orders** (ledger invariant `totalAmount = netAmount +
  orderDiscount + Σ lineDiscount` ⇒ `net + discount = Σ totalAmount`); the **Discount**
  column now correctly includes line discounts for all orders.
- Part 1 (preserve REFUND rows + recompute payment/refund status) shipped first
  (commit `4c4adc9`).

Commits: Part 1 `4c4adc9`; Part 2 `c6d9960` (persist mode/value + migration),
`f9718c4` (shared helper + both call sites), FE `d2d5a0e` (round-trip mode/value +
ignore REFUND rows in the payment form).

## 7. Open items to confirm during implementation
1. The order-level discount **base** (item total vs. item-total-after-line-discounts) —
   match `lines.orderDiscountBase` exactly.
2. Whether any other reader (Finance reports, invoices) relies on `Σ orderDiscount` for
   the discount figure — keep them consistent with the new `gross − net` definition.
